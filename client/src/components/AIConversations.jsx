
import { useState } from "react";
import {
  Sparkles,
  CheckCircle2,
  LoaderCircle,
  Languages,
  Mic,
  MicOff,
} from "lucide-react";

import {
  extractPaymentDetails,
  createCommitment,
} from "../services/api";

function AIConversations() {
  const [message, setMessage] = useState("");
  const [extracted, setExtracted] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [listening, setListening] = useState(false);
  const [speechLanguage, setSpeechLanguage] = useState("hi-IN");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleVoiceInput = () => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setError("Speech recognition is not supported. Please use Chrome.");
      return;
    }

    const recognition = new SpeechRecognition();

    recognition.lang = speechLanguage;
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => {
      setListening(true);
      setError("");
    };

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;

      setMessage((previous) =>
        previous ? `${previous} ${transcript}` : transcript
      );

      setExtracted(null);
    };

    recognition.onerror = (event) => {
      setError(`Voice recognition error: ${event.error}`);
    };

    recognition.onend = () => {
      setListening(false);
    };

    try {
      recognition.start();
    } catch (err) {
      setError("Could not start microphone. Please try again.");
      setListening(false);
    }
  };

  const handleExtract = async () => {
    if (!message.trim()) {
      setError("Please enter or speak a customer message.");
      return;
    }

    try {
      setLoading(true);
      setError("");
      setSuccess("");
      setExtracted(null);

      const data = await extractPaymentDetails(message.trim());

      setExtracted(data);
    } catch (err) {
      setError(err.message || "AI extraction failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (
      !extracted?.customerId ||
      !extracted?.amount ||
      !extracted?.promisedDate ||
      extracted.intent !== "payment_promise"
    ) {
      setError("Valid customer, amount and promised date are required.");
      return;
    }

    try {
      setSaving(true);
      setError("");

      await createCommitment({
        customer: extracted.customerId,
        amount: Number(extracted.amount),
        promisedDate: extracted.promisedDate,
        originalMessage: message.trim(),
        confirmedByVendor: true,
      });

      setSuccess("Payment commitment saved successfully!");
      setExtracted(null);
      setMessage("");
    } catch (err) {
      setError(err.message || "Unable to save commitment.");
    } finally {
      setSaving(false);
    }
  };

  const canSave =
    extracted?.intent === "payment_promise" &&
    extracted?.customerId &&
    Number(extracted?.amount) > 0 &&
    extracted?.promisedDate;

  return (
    <div style={{ maxWidth: "950px", margin: "0 auto" }}>
      <div style={{ marginBottom: "28px" }}>
        <div style={{ color: "#16a36a", fontWeight: 700 }}>
          <Sparkles size={15} /> AI POWERED
        </div>

        <h1>AI Conversations</h1>

        <p style={{ color: "#777" }}>
          Convert customer messages into payment commitments.
        </p>
      </div>

      <div className="panel" style={{ padding: "24px", marginBottom: "22px" }}>
        <h3>Customer message</h3>

        <p style={{ color: "#777", fontSize: "14px" }}>
          Type or speak in Gujarati, Hindi or English.
        </p>

        <label>Voice language</label>

        <select
          value={speechLanguage}
          onChange={(e) => setSpeechLanguage(e.target.value)}
          style={{
            display: "block",
            width: "100%",
            padding: "12px",
            margin: "10px 0",
            borderRadius: "8px",
            border: "1px solid #ddd",
          }}
        >
          <option value="gu-IN">Gujarati</option>
          <option value="hi-IN">Hindi</option>
          <option value="en-IN">English</option>
        </select>

        <textarea
          value={message}
          onChange={(e) => {
            setMessage(e.target.value);
            setExtracted(null);
          }}
          placeholder="Example: Bhai, 27 November ko ₹2,000 de dunga."
          rows={5}
          style={{
            width: "100%",
            padding: "15px",
            border: "1px solid #ddd",
            borderRadius: "10px",
            resize: "vertical",
            font: "inherit",
            boxSizing: "border-box",
            marginTop: "12px",
          }}
        />

        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginTop: "15px" }}>
          <button
            className="secondary-btn"
            onClick={handleVoiceInput}
            disabled={listening || loading}
          >
            {listening ? (
              <>
                <MicOff size={17} /> Listening...
              </>
            ) : (
              <>
                <Mic size={17} /> Speak message
              </>
            )}
          </button>

          <button
            className="primary-btn"
            onClick={handleExtract}
            disabled={loading || listening || !message.trim()}
          >
            {loading ? (
              <>
                <LoaderCircle size={17} /> Analyzing...
              </>
            ) : (
              <>
                <Sparkles size={17} /> Extract with AI
              </>
            )}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: "14px", background: "#fff0f0", color: "#c0392b", borderRadius: "9px", marginBottom: "18px" }}>
          {error}
        </div>
      )}

      {success && (
        <div style={{ padding: "14px", background: "#e9f9ef", color: "#16834b", borderRadius: "9px", marginBottom: "18px" }}>
          <CheckCircle2 size={17} /> {success}
        </div>
      )}

      {extracted && (
        <div className="panel" style={{ padding: "24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap" }}>
            <h3>Extracted payment details</h3>
            <strong style={{ color: "#16834b" }}>
              {Math.round((extracted.confidence || 0) * 100)}% confidence
            </strong>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "16px", margin: "22px 0" }}>
            <div>
              <small>Customer</small>
              <h3>{extracted.customerName || "Not identified"}</h3>
            </div>

            <div>
              <small>Amount</small>
              <h3>
                {extracted.amount
                  ? `₹${Number(extracted.amount).toLocaleString("en-IN")}`
                  : "Not identified"}
              </h3>
            </div>

            <div>
              <small>Promised date</small>
              <h3>{extracted.promisedDate || "Not identified"}</h3>
            </div>

            <div>
              <small>Language</small>
              <h3>
                <Languages size={16} /> {extracted.language || "Unknown"}
              </h3>
            </div>

            <div>
              <small>Intent</small>
              <h3>{extracted.intent || "Unknown"}</h3>
            </div>
          </div>

          <div style={{ background: "#fff8e8", padding: "14px", borderRadius: "9px", marginBottom: "18px" }}>
            Verify all details before saving. AI extraction is not a confirmed payment record.
          </div>

          <button
            className="primary-btn"
            onClick={handleConfirm}
            disabled={!canSave || saving}
          >
            {saving ? "Saving..." : "Confirm & Save"}
          </button>
        </div>
      )}
    </div>
  );
}

export default AIConversations;
