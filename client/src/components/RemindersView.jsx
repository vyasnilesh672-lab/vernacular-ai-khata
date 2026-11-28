import { useEffect, useState } from "react";
import { BellRing, Send, RefreshCw } from "lucide-react";
import {
  getReminderCandidates,
  getReminders,
  getWhatsAppStatus,
  sendReminder,
  sendDueReminders,
} from "../services/api";
import {
  MotionButton,
  StaggerGrid,
  StaggerCard,
  ArcMotionItem,
  StatusPill,
  AnimatedValue,
  SuccessFeedbackBanner,
  ErrorFeedbackBanner,
  SkeletonStatsGrid,
  SkeletonList,
  EmptyStateBox,
} from "../motion/motionPrimitives";

const money = (amount) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount || 0);

const formatDate = (dateValue) => {
  if (!dateValue) return "N/A";
  return new Date(dateValue).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
};

function RemindersView() {
  const [candidates, setCandidates] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [waStatus, setWaStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sendingId, setSendingId] = useState(null);
  const [batchSending, setBatchSending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadAll = async () => {
    try {
      setLoading(true);
      setError("");
      const [cands, rems, wa] = await Promise.all([
        getReminderCandidates({ upcomingDays: 3 }),
        getReminders(),
        getWhatsAppStatus(),
      ]);
      setCandidates(cands);
      setReminders(rems);
      setWaStatus(wa);
    } catch (err) {
      setError(err.message || "Unable to load reminders.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    const init = async () => {
      try {
        const [cands, rems, wa] = await Promise.all([
          getReminderCandidates({ upcomingDays: 3 }),
          getReminders(),
          getWhatsAppStatus(),
        ]);
        if (active) {
          setCandidates(cands);
          setReminders(rems);
          setWaStatus(wa);
          setError("");
        }
      } catch (err) {
        if (active) setError(err.message || "Unable to load reminders.");
      } finally {
        if (active) setLoading(false);
      }
    };
    init();
    return () => {
      active = false;
    };
  }, []);

  const handleSendOne = async (candidate) => {
    try {
      setSendingId(candidate.commitmentId);
      setError("");
      setNotice("");
      await sendReminder({
        commitmentId: candidate.commitmentId,
        language: candidate.language,
      });
      await loadAll();
      setNotice(`Reminder dispatched for ${candidate.customer.name}.`);
    } catch (err) {
      setError(err.message || "Failed to send reminder.");
    } finally {
      setSendingId(null);
    }
  };

  const handleSendDue = async () => {
    try {
      setBatchSending(true);
      setError("");
      setNotice("");
      const res = await sendDueReminders({ upcomingDays: 3 });
      await loadAll();
      setNotice(
        `Sent: ${res.summary.sentCount}, skipped duplicates: ${res.summary.skippedDuplicateCount}.`
      );
    } catch (err) {
      setError(err.message || "Batch reminder send failed.");
    } finally {
      setBatchSending(false);
    }
  };

  const upcomingCount = candidates.filter(
    (c) => c.reminderType === "upcoming" || c.reminderType === "due_today"
  ).length;
  const overdueCount = candidates.filter(
    (c) => c.reminderType === "overdue"
  ).length;

  return (
    <>
      <div className="welcome-row">
        <div>
          <div className="eyebrow">TWO-WAY REMINDER ENGINE</div>
          <h1>Smart Reminders</h1>
          <p>Upcoming and overdue reminders in Gujarati, Hindi, and Hinglish with WhatsApp status tracking.</p>
        </div>

        <div className="header-actions">
          <MotionButton
            className="secondary-btn"
            onClick={loadAll}
            disabled={loading}
          >
            <RefreshCw size={16} className={loading ? "icon-spin" : ""} />{" "}
            {loading ? "Refreshing" : "Refresh"}
          </MotionButton>
          <MotionButton
            className="primary-btn"
            anticipate
            onClick={handleSendDue}
            disabled={batchSending || loading}
          >
            <Send size={16} /> {batchSending ? "Sending..." : "Send due reminders"}
          </MotionButton>
        </div>
      </div>

      <ErrorFeedbackBanner
        message={error}
        onRetry={loadAll}
        onDismiss={() => setError("")}
      />

      <SuccessFeedbackBanner
        message={notice}
        onDismiss={() => setNotice("")}
      />

      {loading ? (
        <SkeletonStatsGrid count={4} />
      ) : (
        <StaggerGrid>
          <StaggerCard>
            <div className="stat-top">
              <span>Upcoming / due today</span>
              <BellRing />
            </div>
            <h2>
              <AnimatedValue value={upcomingCount}>{upcomingCount}</AnimatedValue>
            </h2>
            <small className="muted">Within next 3 days</small>
          </StaggerCard>

          <StaggerCard>
            <div className="stat-top">
              <span>Overdue reminders</span>
              <BellRing />
            </div>
            <h2>
              <AnimatedValue value={overdueCount}>{overdueCount}</AnimatedValue>
            </h2>
            <small className={overdueCount > 0 ? "danger-text" : "muted"}>
              Past promised date
            </small>
          </StaggerCard>

          <StaggerCard>
            <div className="stat-top">
              <span>Sent reminders</span>
              <Send />
            </div>
            <h2>
              <AnimatedValue value={reminders.length}>{reminders.length}</AnimatedValue>
            </h2>
            <small className="muted">Tracked in MongoDB</small>
          </StaggerCard>

          <StaggerCard>
            <div className="stat-top">
              <span>WhatsApp channel</span>
              <Send />
            </div>
            <div style={{ margin: "10px 0 6px" }}>
              <StatusPill
                statusKey={waStatus?.configured ? "cloud" : "mock"}
                className={waStatus?.configured ? "status paid" : "status pending"}
              >
                {waStatus?.configured ? "Cloud API" : "Mock Mode"}
              </StatusPill>
            </div>
            <small className="muted">
              {waStatus?.configured
                ? `Meta ${waStatus.apiVersion} live`
                : "Simulated locally (credentials unset)"}
            </small>
          </StaggerCard>
        </StaggerGrid>
      )}

      <div className="dashboard-grid-2">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h3>Reminder candidates</h3>
              <p>Duplicate-safe per commitment per day.</p>
            </div>
          </div>

          {loading ? (
            <SkeletonList rows={3} />
          ) : candidates.length > 0 ? (
            <div className="item-list">
              {candidates.map((cand, idx) => (
                <ArcMotionItem key={cand.commitmentId} index={idx}>
                  <div>
                    <strong>
                      {cand.customer?.name} · {money(cand.outstandingAmount)}
                    </strong>
                    <small>
                      Due {formatDate(cand.promisedDate)} · {cand.language} ·{" "}
                      {cand.reminderType.replace(/_/g, " ")}
                    </small>
                    <small style={{ color: "var(--ink)", marginTop: "6px" }}>
                      {cand.previewMessage}
                    </small>
                  </div>
                  <MotionButton
                    className="primary-btn"
                    anticipate={!cand.alreadySentToday}
                    disabled={
                      cand.alreadySentToday || sendingId === cand.commitmentId
                    }
                    onClick={() => handleSendOne(cand)}
                  >
                    {cand.alreadySentToday
                      ? "Sent today"
                      : sendingId === cand.commitmentId
                        ? "Sending..."
                        : "Send"}
                  </MotionButton>
                </ArcMotionItem>
              ))}
            </div>
          ) : (
            <EmptyStateBox message="No upcoming or overdue reminders pending." />
          )}
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <h3>Delivery status history</h3>
              <p>WhatsApp Cloud API & mock adapter dispatch log.</p>
            </div>
          </div>

          {loading ? (
            <SkeletonList rows={3} />
          ) : reminders.length > 0 ? (
            <div className="item-list">
              {reminders.map((rem, idx) => (
                <ArcMotionItem key={rem._id} index={idx}>
                  <div>
                    <strong>
                      {rem.customer?.name || "Customer"} ·{" "}
                      {money(rem.outstandingAmountSnapshot)}
                    </strong>
                    <small>
                      {formatDate(rem.createdAt)} ·{" "}
                      {rem.isMock ? "Mock Adapter (not real WhatsApp)" : "WhatsApp Cloud API"} ·{" "}
                      {rem.reminderType.replace(/_/g, " ")}
                    </small>
                  </div>
                  <StatusPill
                    statusKey={rem.deliveryStatus}
                    className={
                      rem.deliveryStatus === "failed"
                        ? "status overdue"
                        : rem.deliveryStatus === "delivered" ||
                            rem.deliveryStatus === "read"
                          ? "status paid"
                          : "status pending"
                    }
                  >
                    {rem.deliveryStatus}
                  </StatusPill>
                </ArcMotionItem>
              ))}
            </div>
          ) : (
            <EmptyStateBox message="No reminders dispatched yet." />
          )}
        </section>
      </div>
    </>
  );
}

export default RemindersView;
