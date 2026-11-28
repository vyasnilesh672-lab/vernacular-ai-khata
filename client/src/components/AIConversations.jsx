import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Sparkles,
  LoaderCircle,
  Mic,
  MicOff,
  Send,
  RotateCcw,
} from "lucide-react";

import {
  sendUnifiedCommand,
  confirmUnifiedCommand,
  rejectUnifiedCommand,
} from "../services/api";
import {
  AI_COMMAND_POSES,
  ARC_EASE,
  SMOOTH_EASE,
  TIMINGS,
} from "../motion/motionTokens";
import {
  ErrorFeedbackBanner,
  MotionButton,
  PoseStepRail,
  StatusPill,
  SuccessFeedbackBanner,
} from "../motion/motionPrimitives";
import CommandConfirmationPreview from "./CommandConfirmationPreview";
import CustomerIntelligenceResult from "./CustomerIntelligenceResult";

const CONFIRM_MESSAGE_PATTERN =
  /^(confirm|confirmed|haan\s*confirm(\s*karo)?|ha\s*confirm|yes(\s*confirm)?|ok\s*save(\s*karo)?|save\s*karo|pakka\s*save)\.?$/i;

const INITIAL_LEVELS = Array.from({ length: 12 }, () => 4);

function AIConversations() {
  const [message, setMessage] = useState("");
  const [speechLanguage, setSpeechLanguage] = useState("hi-IN");
  const [sessionId, setSessionId] = useState(null);
  const [confirmationToken, setConfirmationToken] = useState(null);
  const [activeSession, setActiveSession] = useState(null);
  const [readOnlyResult, setReadOnlyResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [listening, setListening] = useState(false);
  const [audioLevels, setAudioLevels] = useState(INITIAL_LEVELS);
  const [hasLiveMeter, setHasLiveMeter] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const recognitionRef = useRef(null);
  const audioCleanupRef = useRef(null);

  const stopAudioMeter = () => {
    if (audioCleanupRef.current) {
      audioCleanupRef.current();
      audioCleanupRef.current = null;
    }
    setHasLiveMeter(false);
    setAudioLevels(INITIAL_LEVELS);
  };

  const startRealAudioMeter = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) return;
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioCtx();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      setHasLiveMeter(true);

      const intervalId = window.setInterval(() => {
        analyser.getByteFrequencyData(dataArray);
        const nextLevels = Array.from({ length: 12 }, (_, idx) => {
          const val = dataArray[idx % dataArray.length] || 0;
          return Math.max(4, Math.min(26, Math.round((val / 255) * 24) + 4));
        });
        setAudioLevels(nextLevels);
      }, 60);

      audioCleanupRef.current = () => {
        window.clearInterval(intervalId);
        stream.getTracks().forEach((t) => t.stop());
        if (ctx.state !== "closed") {
          ctx.close().catch(() => {});
        }
      };
    } catch {
      setHasLiveMeter(false);
    }
  };

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
      if (audioCleanupRef.current) {
        audioCleanupRef.current();
      }
    };
  }, []);

  const resetConversation = () => {
    setMessage("");
    setSessionId(null);
    setConfirmationToken(null);
    setActiveSession(null);
    setReadOnlyResult(null);
    setError("");
    setSuccess("");
  };

  const submitCommand = async (rawText) => {
    const trimmed = rawText.trim();
    if (!trimmed || loading || saving) return;

    const isConfirmTurn =
      Boolean(sessionId) &&
      activeSession?.status === "awaiting_confirmation" &&
      Boolean(confirmationToken) &&
      CONFIRM_MESSAGE_PATTERN.test(trimmed);

    try {
      setLoading(true);
      setError("");
      setSuccess("");

      const data = await sendUnifiedCommand({
        message: trimmed,
        sessionId:
          activeSession &&
          (activeSession.status === "awaiting_clarification" ||
            activeSession.status === "awaiting_confirmation")
            ? sessionId
            : null,
        confirmationToken: isConfirmTurn ? confirmationToken : undefined,
      });

      setMessage("");
      setSessionId(data.sessionId);
      setActiveSession(data);
      setConfirmationToken(data.confirmationToken || null);

      if (data.isReadOnly && data.status === "executed") {
        setReadOnlyResult(data.executionResult || null);
      } else {
        setReadOnlyResult(null);
      }

      if (!data.isReadOnly && data.status === "executed") {
        setSuccess(
          `Confirmed & saved: ${data.commandCategory.replace(/_/g, " ")}.`
        );
        setConfirmationToken(null);
      } else if (data.status === "rejected") {
        setConfirmationToken(null);
      }
    } catch (err) {
      if (err.status === 410 || err.status === 409) {
        setConfirmationToken(null);
      }
      setError(err.message || "Unable to process command.");
    } finally {
      setLoading(false);
    }
  };

  const handleVoiceInput = () => {
    if (listening && recognitionRef.current) {
      recognitionRef.current.stop();
      stopAudioMeter();
      return;
    }

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setError("Speech recognition is not supported. Please use Chrome.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;

    recognition.lang = speechLanguage;
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setListening(true);
      setError("");
      startRealAudioMeter();
    };

    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript?.trim();
      if (!transcript) {
        setError("Could not hear speech clearly. Please speak again.");
        return;
      }

      setMessage(transcript);
      submitCommand(transcript);
    };

    recognition.onnomatch = () => {
      setError("Speech was unclear. Please try speaking again.");
    };

    recognition.onerror = (event) => {
      if (event.error === "no-speech") {
        setError("No speech detected. Please speak closer to the microphone.");
      } else if (event.error === "not-allowed") {
        setError("Microphone permission denied. Please allow microphone access.");
      } else {
        setError(`Voice recognition error: ${event.error}`);
      }
    };

    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
      stopAudioMeter();
    };

    try {
      recognition.start();
    } catch {
      setError("Could not start microphone. Please try again.");
      setListening(false);
      recognitionRef.current = null;
      stopAudioMeter();
    }
  };

  const handleConfirm = async () => {
    if (saving || !sessionId || !confirmationToken) return;

    try {
      setSaving(true);
      setError("");
      setSuccess("");

      const data = await confirmUnifiedCommand({
        sessionId,
        confirmationToken,
      });

      setActiveSession(data);
      setConfirmationToken(null);
      setSuccess(
        `Confirmed & saved: ${data.commandCategory.replace(/_/g, " ")}.`
      );
    } catch (err) {
      if (err.status === 410 || err.status === 409) {
        setConfirmationToken(null);
      }
      if (err.data?.confirmationToken) {
        setConfirmationToken(err.data.confirmationToken);
      }
      setError(err.message || "Unable to confirm command.");
    } finally {
      setSaving(false);
    }
  };

  const handleReject = async () => {
    if (saving || !sessionId) return;

    try {
      setSaving(true);
      setError("");
      setSuccess("");

      const data = await rejectUnifiedCommand({
        sessionId,
        reason: "Rejected by vendor in UI",
      });

      setActiveSession(data);
      setConfirmationToken(null);
    } catch (err) {
      setError(err.message || "Unable to cancel command.");
    } finally {
      setSaving(false);
    }
  };

  const turns = Array.isArray(activeSession?.turns) ? activeSession.turns : [];

  // Principle 04 (Pose-to-Pose): Explicit state machine
  const currentPose = listening
    ? "recording"
    : loading || saving
      ? "processing"
      : activeSession?.status === "executed"
        ? "confirmed"
        : activeSession && activeSession.status !== "rejected"
          ? "preview"
          : "idle";

  return (
    <div style={{ maxWidth: "950px", margin: "0 auto" }}>
      <motion.div
        className="welcome-row"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: TIMINGS.page, ease: SMOOTH_EASE }}
        style={{ marginBottom: "18px" }}
      >
        <div>
          <div className="eyebrow">
            <motion.span
              style={{ display: "inline-flex", marginRight: "6px" }}
              animate={loading ? { rotate: [0, 12, -12, 0] } : { rotate: 0 }}
              transition={{ duration: 0.45 }}
            >
              <Sparkles size={13} />
            </motion.span>
            UNIFIED AI KHATA
          </div>
          <h1>AI Conversations</h1>
          <p>
            Speak or type in Gujarati, Hindi or Hinglish for payments, inventory, transformations, and customer risk.
          </p>
        </div>

        {(activeSession || message) && (
          <MotionButton
            className="secondary-btn"
            onClick={resetConversation}
            disabled={loading || saving || listening}
          >
            <RotateCcw size={15} /> New conversation
          </MotionButton>
        )}
      </motion.div>

      <PoseStepRail poses={AI_COMMAND_POSES} activePose={currentPose} />

      <AnimatePresence>
        {turns.length > 0 && (
          <motion.div
            className="panel"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: TIMINGS.card, ease: SMOOTH_EASE }}
            style={{ padding: "20px", marginBottom: "20px" }}
          >
            <div className="panel-heading" style={{ marginBottom: "12px" }}>
              <h3>Conversation</h3>
              <StatusPill
                statusKey={activeSession?.status}
                className="status promised"
              >
                {activeSession?.status?.replace(/_/g, " ")}
              </StatusPill>
            </div>

            <div style={{ display: "grid", gap: "10px" }}>
              {turns.map((turn, index) => (
                <motion.div
                  key={`${index}-${turn.role}`}
                  initial={{
                    opacity: 0,
                    x: turn.role === "vendor" ? 16 : -16,
                    y: 10,
                  }}
                  animate={{
                    opacity: 1,
                    x: [turn.role === "vendor" ? 16 : -16, 0],
                    y: [10, -2, 0],
                  }}
                  transition={{ duration: TIMINGS.card, ease: ARC_EASE }}
                  style={{
                    padding: "11px 14px",
                    borderRadius: "10px",
                    background:
                      turn.role === "vendor" ? "var(--teal-soft)" : "var(--ivory)",
                    border: "1px solid var(--border)",
                    fontSize: "13px",
                  }}
                >
                  <strong
                    style={{
                      display: "block",
                      fontSize: "11px",
                      color: turn.role === "vendor" ? "var(--teal)" : "var(--muted)",
                      marginBottom: "4px",
                    }}
                  >
                    {turn.role === "vendor" ? "Vendor" : "Khata Assistant"}
                  </strong>
                  <span>{turn.text}</span>
                </motion.div>
              ))}

              {loading && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="item-row"
                  style={{ justifyContent: "flex-start" }}
                >
                  <div className="typing-dots" aria-label="AI thinking">
                    <span />
                    <span />
                    <span />
                  </div>
                  <small className="muted" style={{ marginLeft: "10px" }}>
                    Understanding vernacular command...
                  </small>
                </motion.div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <ErrorFeedbackBanner
        message={error}
        onDismiss={() => setError("")}
      />

      <SuccessFeedbackBanner
        message={success}
        onDismiss={() => setSuccess("")}
      />

      <CommandConfirmationPreview
        session={activeSession}
        confirmationToken={confirmationToken}
        saving={saving}
        onConfirm={handleConfirm}
        onReject={handleReject}
      />

      <AnimatePresence>
        {readOnlyResult && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: TIMINGS.card, ease: SMOOTH_EASE }}
          >
            <CustomerIntelligenceResult result={readOnlyResult} />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="panel" style={{ padding: "24px", marginBottom: "22px" }}>
        <h3>
          {activeSession?.status === "awaiting_clarification"
            ? "Reply to clarify"
            : activeSession?.status === "awaiting_confirmation"
              ? "Edit or confirm"
              : "Vendor command"}
        </h3>

        <p style={{ color: "var(--muted)", fontSize: "13px", marginTop: "4px" }}>
          Examples: &ldquo;Rameshbhai ne 5000 rupiya aapvana che.&rdquo; · &ldquo;Aaje 20 kilo raw garlic aavyu.&rdquo; · &ldquo;Rameshbhai na ketla baki che?&rdquo;
        </p>

        <label
          style={{
            display: "block",
            marginTop: "14px",
            fontSize: "12px",
            fontWeight: 700,
          }}
        >
          Voice language
        </label>

        <select
          aria-label="Voice language"
          value={speechLanguage}
          onChange={(e) => setSpeechLanguage(e.target.value)}
          style={{
            display: "block",
            width: "100%",
            padding: "11px 12px",
            margin: "8px 0",
            borderRadius: "8px",
            border: "1px solid var(--border)",
            background: "#FFFFFF",
            color: "var(--ink)",
          }}
        >
          <option value="gu-IN">Gujarati</option>
          <option value="hi-IN">Hindi / Hinglish</option>
          <option value="en-IN">English</option>
        </select>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitCommand(message);
          }}
        >
          <textarea
            aria-label="Command message"
            value={message}
            onChange={(e) => {
              setMessage(e.target.value);
              setError("");
            }}
            placeholder={
              activeSession?.status === "awaiting_clarification"
                ? "Reply with the missing detail (e.g. Next Friday or 2026-12-04)..."
                : activeSession?.status === "awaiting_confirmation"
                  ? "Type 'Confirm.' or edit a detail (e.g. Amount 4000 karo)..."
                  : "Type or speak a payment, inventory, transformation, or customer query..."
            }
            rows={4}
            style={{
              width: "100%",
              padding: "14px",
              border: "1px solid var(--border)",
              borderRadius: "10px",
              resize: "vertical",
              font: "inherit",
              boxSizing: "border-box",
              marginTop: "8px",
              background: "#FFFFFF",
              color: "var(--ink)",
            }}
          />

          <div
            style={{
              display: "flex",
              gap: "12px",
              alignItems: "center",
              flexWrap: "wrap",
              marginTop: "14px",
            }}
          >
            <div className="mic-anticipation-wrap">
              <AnimatePresence>
                {listening && (
                  <motion.span
                    className="mic-anticipation-ring"
                    initial={{ scale: 0.9, opacity: 0.85 }}
                    animate={{ scale: 1.15, opacity: 0 }}
                    transition={{ duration: 0.55, ease: SMOOTH_EASE }}
                  />
                )}
              </AnimatePresence>
              <MotionButton
                className={listening ? "teal-btn" : "secondary-btn"}
                onClick={handleVoiceInput}
                disabled={loading || saving}
                anticipate
              >
                {listening ? (
                  <>
                    <MicOff size={17} /> Stop listening
                  </>
                ) : (
                  <>
                    <Mic size={17} /> Speak message
                  </>
                )}
              </MotionButton>
            </div>

            {listening && hasLiveMeter && (
              <motion.div
                className="waveform-strip"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                aria-label="Live microphone input"
              >
                {audioLevels.map((height, idx) => (
                  <span
                    key={idx}
                    className="waveform-bar"
                    style={{ height: `${height}px` }}
                  />
                ))}
              </motion.div>
            )}

            {listening && !hasLiveMeter && (
              <small className="muted">Listening via browser speech recognition...</small>
            )}

            <MotionButton
              type="submit"
              className="primary-btn"
              disabled={loading || saving || listening || !message.trim()}
              anticipate
            >
              {loading ? (
                <>
                  <LoaderCircle size={17} className="icon-spin" /> Processing...
                </>
              ) : (
                <>
                  <Send size={17} /> Send command
                </>
              )}
            </MotionButton>
          </div>
        </form>
      </div>
    </div>
  );
}

export default AIConversations;
