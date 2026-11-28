import { Fragment, useEffect, useState } from "react";
import { LayoutGroup, motion } from "framer-motion";
import {
  Wallet,
  RefreshCw,
  CheckCircle2,
  Clock,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

import {
  getCommitments,
  markPaymentReceived,
  updateCommitmentStatus,
} from "../services/api";
import {
  ARC_EASE,
  ELASTIC_TAP_SPRING,
  FOLLOW_THROUGH_SPRING,
  TIMINGS,
} from "../motion/motionTokens";
import {
  MotionButton,
  StaggerGrid,
  StaggerCard,
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

const formatDate = (date) => {
  if (!date) return "Not available";

  return new Date(date).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
};

const getTodayIST = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

function PaymentLedger() {
  const [commitments, setCommitments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successNotice, setSuccessNotice] = useState("");
  const [updatingId, setUpdatingId] = useState(null);
  const [search, setSearch] = useState("");
  const [filterMode, setFilterMode] = useState("All");
  const [expandedId, setExpandedId] = useState(null);

  const loadCommitments = async () => {
    try {
      setError("");
      setLoading(true);

      const data = await getCommitments();
      setCommitments(data);
    } catch {
      setError("Unable to load payment records.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;

    const fetchInitialCommitments = async () => {
      try {
        const data = await getCommitments();
        if (active) {
          setCommitments(data);
          setError("");
        }
      } catch {
        if (active) {
          setError("Unable to load payment records.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    fetchInitialCommitments();

    return () => {
      active = false;
    };
  }, []);

  const handleMarkPaid = async (id) => {
    try {
      setError("");
      setSuccessNotice("");
      setUpdatingId(id);
      const updated = await markPaymentReceived(id);
      await loadCommitments();
      setSuccessNotice(
        `Payment confirmed for ${updated.customer?.name || "customer"} (${money(updated.amount)}).`
      );
    } catch (err) {
      setError(err.message || "Payment update failed.");
    } finally {
      setUpdatingId(null);
    }
  };

  const handleStatusChange = async (id, status) => {
    try {
      setError("");
      setSuccessNotice("");
      setUpdatingId(id);

      await updateCommitmentStatus(id, status);
      await loadCommitments();
      setSuccessNotice(`Commitment status updated to ${status}.`);
    } catch (err) {
      setError(err.message || "Status update failed.");
    } finally {
      setUpdatingId(null);
    }
  };

  const todayISO = getTodayIST();
  const paidRecords = commitments.filter(
    (item) => item.paymentStatus === "Paid"
  );
  const unpaidRecords = commitments.filter(
    (item) => item.paymentStatus !== "Paid"
  );
  const overdueRecords = unpaidRecords.filter(
    (item) =>
      item.promisedDate &&
      new Date(item.promisedDate).toISOString().slice(0, 10) < todayISO
  );

  const paidAmount = paidRecords.reduce(
    (total, item) => total + item.amount,
    0
  );
  const unpaidAmount = unpaidRecords.reduce(
    (total, item) => total + item.amount,
    0
  );

  const filteredCommitments = commitments.filter((item) => {
    const name = item.customer?.name || "Unknown customer";
    const matchesSearch = name.toLowerCase().includes(search.toLowerCase());
    if (!matchesSearch) return false;
    if (filterMode === "Paid") return item.paymentStatus === "Paid";
    if (filterMode === "Unpaid") return item.paymentStatus !== "Paid";
    if (filterMode === "Overdue") {
      return (
        item.paymentStatus !== "Paid" &&
        item.promisedDate &&
        new Date(item.promisedDate).toISOString().slice(0, 10) < todayISO
      );
    }
    return true;
  });

  return (
    <>
      <div className="welcome-row">
        <div>
          <div className="eyebrow">PAYMENT MANAGEMENT</div>
          <h1>Payment Ledger</h1>
          <p>Track customer promises and actual confirmed payments.</p>
        </div>

        <MotionButton
          className="primary-btn"
          onClick={loadCommitments}
          disabled={loading}
        >
          <RefreshCw size={17} className={loading ? "icon-spin" : ""} />{" "}
          {loading ? "Refreshing..." : "Refresh records"}
        </MotionButton>
      </div>

      {loading ? (
        <SkeletonStatsGrid count={4} />
      ) : (
        <StaggerGrid>
          <StaggerCard>
            <div className="stat-top">
              <span>Total commitments</span>
              <Wallet />
            </div>
            <h2>
              <AnimatedValue value={commitments.length}>
                {commitments.length}
              </AnimatedValue>
            </h2>
            <small className="muted">All confirmed records</small>
          </StaggerCard>

          <StaggerCard>
            <div className="stat-top">
              <span>Outstanding</span>
              <Clock />
            </div>
            <h2>
              <AnimatedValue value={unpaidAmount}>
                {money(unpaidAmount)}
              </AnimatedValue>
            </h2>
            <small className="muted">
              {unpaidRecords.length} unpaid ({overdueRecords.length} overdue)
            </small>
          </StaggerCard>

          <StaggerCard>
            <div className="stat-top">
              <span>Payment received</span>
              <CheckCircle2 />
            </div>
            <h2>
              <AnimatedValue value={paidAmount}>
                {money(paidAmount)}
              </AnimatedValue>
            </h2>
            <small className="success-text">
              {paidRecords.length} paid records
            </small>
          </StaggerCard>

          <StaggerCard>
            <div className="stat-top">
              <span>Total committed</span>
              <Wallet />
            </div>
            <h2>
              <AnimatedValue value={paidAmount + unpaidAmount}>
                {money(paidAmount + unpaidAmount)}
              </AnimatedValue>
            </h2>
            <small className="muted">Total recorded amount</small>
          </StaggerCard>
        </StaggerGrid>
      )}

      <SuccessFeedbackBanner
        message={successNotice}
        onDismiss={() => setSuccessNotice("")}
      />

      <section className="panel ledger-panel">
        <div className="panel-heading">
          <div>
            <h3>Customer payment records</h3>
            <p>Live data from your MongoDB database.</p>
          </div>
        </div>

        <div
          className="table-controls"
          style={{ flexWrap: "wrap", alignItems: "center" }}
        >
          <input
            placeholder="Search customer..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <LayoutGroup id="ledger-filter-group">
            <div className="filter-pills">
              {["All", "Unpaid", "Paid", "Overdue"].map((mode) => {
                const isActive = filterMode === mode;
                return (
                  <motion.button
                    key={mode}
                    type="button"
                    className={`filter-pill ${isActive ? "active" : ""}`}
                    onClick={() => setFilterMode(mode)}
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scaleX: 0.95, scaleY: 0.93 }}
                    transition={ELASTIC_TAP_SPRING}
                    style={{
                      position: "relative",
                      ...(isActive ? { background: "transparent" } : {}),
                    }}
                  >
                    {isActive && (
                      <motion.span
                        layoutId="ledger-filter-pill"
                        transition={FOLLOW_THROUGH_SPRING}
                        style={{
                          position: "absolute",
                          inset: 0,
                          background: "var(--teal)",
                          borderRadius: "999px",
                          zIndex: 0,
                        }}
                      />
                    )}
                    <span style={{ position: "relative", zIndex: 1 }}>{mode}</span>
                  </motion.button>
                );
              })}
            </div>
          </LayoutGroup>
        </div>

        <ErrorFeedbackBanner
          message={error}
          onRetry={loadCommitments}
          onDismiss={() => setError("")}
        />

        {loading ? (
          <SkeletonList rows={4} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>CUSTOMER</th>
                  <th>AMOUNT</th>
                  <th>PROMISED DATE</th>
                  <th>COMMITMENT STATUS</th>
                  <th>PAYMENT</th>
                  <th>ACTION</th>
                </tr>
              </thead>

              <tbody>
                {filteredCommitments.length > 0 ? (
                  filteredCommitments.map((item, idx) => {
                    const isPaid = item.paymentStatus === "Paid";
                    const isUpdating = updatingId === item._id;
                    const isExpanded = expandedId === item._id;

                    return (
                      <Fragment key={item._id}>
                        <motion.tr
                          initial={{ opacity: 0, x: -6, y: 4 }}
                          animate={{ opacity: 1, x: 0, y: 0 }}
                          transition={{
                            duration: TIMINGS.micro,
                            delay: Math.min(idx * 0.02, 0.16),
                            ease: ARC_EASE,
                          }}
                        >
                          <td>
                            <strong>
                              {item.customer?.name || "Unknown customer"}
                            </strong>
                            <small style={{ display: "block", color: "var(--muted)" }}>
                              {item.transactionType === "payment_received"
                                ? "Payment received"
                                : item.transactionType === "udhaar_balance"
                                  ? "Baki / Udhaar"
                                  : "Payment promise"}
                            </small>
                          </td>

                          <td>
                            <strong>{money(item.amount)}</strong>
                          </td>

                          <td>{formatDate(item.promisedDate)}</td>

                          <td>
                            <select
                              className="status-select"
                              value={item.status}
                              disabled={isUpdating}
                              onChange={(e) =>
                                handleStatusChange(item._id, e.target.value)
                              }
                            >
                              <option value="Pending">Pending</option>
                              <option value="Kept">Kept</option>
                              <option value="Broken">Broken</option>
                              <option value="Renegotiated">Renegotiated</option>
                            </select>
                          </td>

                          <td>
                            <StatusPill
                              statusKey={isPaid ? "Paid" : "Unpaid"}
                              className={isPaid ? "status paid" : "status pending"}
                            >
                              {isPaid ? "Paid" : "Unpaid"}
                            </StatusPill>
                          </td>

                          <td>
                            <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                              <MotionButton
                                className="text-btn"
                                anticipate={!isPaid}
                                disabled={isPaid || isUpdating}
                                onClick={() => handleMarkPaid(item._id)}
                              >
                                {isPaid
                                  ? "Payment received"
                                  : isUpdating
                                    ? "Updating..."
                                    : "Mark as Paid"}
                              </MotionButton>
                              <MotionButton
                                className="text-btn"
                                onClick={() =>
                                  setExpandedId(isExpanded ? null : item._id)
                                }
                                ariaLabel="Toggle payment details"
                              >
                                {isExpanded ? (
                                  <ChevronUp size={15} />
                                ) : (
                                  <ChevronDown size={15} />
                                )}
                              </MotionButton>
                            </div>
                          </td>
                        </motion.tr>

                        {isExpanded && (
                          <tr key={`${item._id}-detail`}>
                            <td colSpan="6" style={{ whiteSpace: "normal" }}>
                              <motion.div
                                className="detail-drawer"
                                initial={{ opacity: 0, height: 0, y: -4 }}
                                animate={{ opacity: 1, height: "auto", y: 0 }}
                                transition={FOLLOW_THROUGH_SPRING}
                                style={{ overflow: "hidden" }}
                              >
                                <div>
                                  <strong>Original message:</strong>{" "}
                                  {item.originalMessage}
                                </div>
                                <div style={{ marginTop: "6px", color: "var(--muted)" }}>
                                  Created: {formatDate(item.createdAt)} ·{" "}
                                  {item.paidAt
                                    ? `Paid on: ${formatDate(item.paidAt)}`
                                    : "Payment not yet received"}
                                  {item.originalAmount && item.originalAmount !== item.amount
                                    ? ` · Original commitment: ${money(item.originalAmount)}`
                                    : ""}
                                </div>
                                {Array.isArray(item.history) && item.history.length > 0 && (
                                  <div style={{ marginTop: "8px" }}>
                                    <strong>Audit trail:</strong>
                                    {item.history.map((h, i) => (
                                      <div key={i} className="muted">
                                        • {h.action.replace(/_/g, " ")} — {h.note || h.newStatus}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </motion.div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan="6">
                      <EmptyStateBox message="No matching payment records found." />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

export default PaymentLedger;
