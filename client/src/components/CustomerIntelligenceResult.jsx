import { useState } from "react";
import { motion } from "framer-motion";
import { ShieldAlert, Wallet, CheckCircle2, Clock } from "lucide-react";
import { SMOOTH_EASE, TIMINGS } from "../motion/motionTokens";
import {
  FocusStageCard,
  ArcMotionItem,
  AnimatedValue,
  StatusPill,
  MotionButton,
  FollowThroughDrawer,
} from "../motion/motionPrimitives";

const formatRupees = (amount) =>
  `₹${Number(amount || 0).toLocaleString("en-IN")}`;

const formatDate = (dateValue) => {
  if (!dateValue) return "N/A";
  return new Date(dateValue).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
};

function RiskGauge({ score, riskLevel }) {
  const numericScore =
    score !== null && score !== undefined ? Math.max(0, Math.min(100, score)) : 0;
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const targetOffset =
    score !== null && score !== undefined
      ? circumference - (numericScore / 100) * circumference
      : circumference;

  const strokeColor =
    riskLevel === "High"
      ? "var(--coral)"
      : riskLevel === "Moderate"
        ? "#D98A2B"
        : "var(--teal)";

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: "12px" }}>
      <svg width="84" height="84" viewBox="0 0 84 84" aria-hidden="true">
        <circle
          cx="42"
          cy="42"
          r={radius}
          fill="none"
          stroke="var(--border)"
          strokeWidth="8"
        />
        <motion.circle
          cx="42"
          cy="42"
          r={radius}
          fill="none"
          stroke={strokeColor}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: targetOffset }}
          transition={{ duration: TIMINGS.sequence, ease: SMOOTH_EASE }}
          transform="rotate(-90 42 42)"
        />
        <text
          x="42"
          y="46"
          textAnchor="middle"
          fill="var(--ink)"
          fontSize="15"
          fontWeight="800"
        >
          {score !== null && score !== undefined ? score : "N/A"}
        </text>
      </svg>
    </div>
  );
}

function CustomerIntelligenceResult({ result }) {
  const [showAllActivity, setShowAllActivity] = useState(false);

  if (!result) return null;

  const {
    customer,
    financialProfile = {},
    riskAssessment = {},
    pattern = {},
    insights = [],
    localizedInsights = [],
  } = result;

  const recentActivity = Array.isArray(financialProfile.recentPaymentActivity)
    ? financialProfile.recentPaymentActivity
    : [];

  const paymentsOnly = recentActivity.filter(
    (item) => item.entryKind === "actual_payment"
  );

  const riskBadgeClass =
    riskAssessment.riskLevel === "High"
      ? "status overdue"
      : riskAssessment.riskLevel === "Moderate"
        ? "status pending"
        : riskAssessment.riskLevel === "Low"
          ? "status paid"
          : "status promised";

  const hasOverflowActivity = paymentsOnly.length > 5 || recentActivity.length > 5;

  return (
    <FocusStageCard
      focused={true}
      style={{ padding: "24px", marginBottom: "22px" }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "12px",
          marginBottom: "18px",
        }}
      >
        <div>
          <StatusPill statusKey="read-only-intelligence" className="status promised" style={{ marginBottom: "8px" }}>
            READ-ONLY CUSTOMER INTELLIGENCE
          </StatusPill>
          <h3>{customer?.name || "Customer"}</h3>
          <small className="muted">{customer?.phone}</small>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap" }}>
          <RiskGauge
            score={riskAssessment.riskScore}
            riskLevel={riskAssessment.riskLevel}
          />
          <div>
            <StatusPill statusKey={riskAssessment.riskLevel} className={riskBadgeClass}>
              Estimated Risk:{" "}
              {riskAssessment.riskScore !== null &&
              riskAssessment.riskScore !== undefined
                ? `${riskAssessment.riskLevel} (${riskAssessment.riskScore}/100)`
                : riskAssessment.riskLevel || "Insufficient history"}
            </StatusPill>
            <small
              className="muted"
              style={{ display: "block", marginTop: "6px", maxWidth: "240px" }}
            >
              {riskAssessment.disclaimer ||
                "Risk score is an estimate from recorded history, not a guarantee."}
            </small>
          </div>
        </div>
      </div>

      <div className="stats-grid" style={{ marginBottom: "18px" }}>
        <div className="stat-card" style={{ padding: "16px" }}>
          <div className="stat-top">
            <span>Outstanding balance</span>
            <Clock />
          </div>
          <h2 style={{ fontSize: "22px", margin: "12px 0 4px" }}>
            <AnimatedValue value={financialProfile.outstandingBalance || 0}>
              {formatRupees(financialProfile.outstandingBalance)}
            </AnimatedValue>
          </h2>
          <small className="muted">
            {financialProfile.overdueCommitmentsCount || 0} overdue
          </small>
        </div>

        <div className="stat-card" style={{ padding: "16px" }}>
          <div className="stat-top">
            <span>Total paid</span>
            <CheckCircle2 />
          </div>
          <h2 style={{ fontSize: "22px", margin: "12px 0 4px" }}>
            <AnimatedValue value={financialProfile.totalAmountPaid || 0}>
              {formatRupees(financialProfile.totalAmountPaid)}
            </AnimatedValue>
          </h2>
          <small className="success-text">
            {financialProfile.completedCommitmentsCount || 0} completed
          </small>
        </div>

        <div className="stat-card" style={{ padding: "16px" }}>
          <div className="stat-top">
            <span>Total purchases</span>
            <Wallet />
          </div>
          <h2 style={{ fontSize: "22px", margin: "12px 0 4px" }}>
            <AnimatedValue value={financialProfile.totalPurchases || 0}>
              {formatRupees(financialProfile.totalPurchases)}
            </AnimatedValue>
          </h2>
          <small className="muted">
            {financialProfile.totalPurchaseTransactions || 0} sale(s)
          </small>
        </div>

        <div className="stat-card" style={{ padding: "16px" }}>
          <div className="stat-top">
            <span>Pattern trend</span>
            <ShieldAlert />
          </div>
          <h2
            style={{
              fontSize: "20px",
              margin: "12px 0 4px",
              textTransform: "capitalize",
            }}
          >
            {(pattern.trend || "insufficient_history").replace(/_/g, " ")}
          </h2>
          <small className="muted">
            {financialProfile.averagePaymentDelayAvailable
              ? `Avg delay: ${financialProfile.averagePaymentDelayDays}d`
              : "Avg delay: Insufficient data"}
          </small>
        </div>
      </div>

      {(localizedInsights.length > 0 || insights.length > 0) && (
        <div
          style={{
            background: "var(--teal-soft)",
            border: "1px solid var(--border)",
            padding: "14px",
            borderRadius: "10px",
            marginBottom: "16px",
            fontSize: "13px",
          }}
        >
          <strong style={{ display: "block", marginBottom: "6px" }}>
            Key Insights
          </strong>
          {(localizedInsights.length > 0 ? localizedInsights : insights).map(
            (line, idx) => (
              <div key={idx} style={{ marginBottom: "3px" }}>
                • {line}
              </div>
            )
          )}
        </div>
      )}

      {Array.isArray(riskAssessment.reasons) &&
        riskAssessment.reasons.length > 0 && (
          <div
            style={{
              background: "#FFF8E8",
              padding: "14px",
              borderRadius: "10px",
              marginBottom: "16px",
              fontSize: "13px",
            }}
          >
            <strong style={{ display: "block", marginBottom: "6px" }}>
              Estimated Risk Explanation
            </strong>
            {riskAssessment.reasons.map((reason, idx) => (
              <div key={idx} style={{ marginBottom: "3px" }}>
                • {reason}
              </div>
            ))}
          </div>
        )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: "16px",
        }}
      >
        <div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "8px",
            }}
          >
            <h4 style={{ margin: 0 }}>Payment history</h4>
            {hasOverflowActivity && (
              <MotionButton
                className="text-btn"
                onClick={() => setShowAllActivity((prev) => !prev)}
              >
                {showAllActivity ? "Show recent" : "Show more"}
              </MotionButton>
            )}
          </div>
          {paymentsOnly.length > 0 ? (
            <div className="item-list">
              {paymentsOnly.slice(0, 5).map((item, idx) => (
                <ArcMotionItem key={item.entryId} index={idx}>
                  <span>
                    {formatDate(item.date)} ({item.sourceType?.replace(/_/g, " ")})
                  </span>
                  <strong>{formatRupees(item.amount)}</strong>
                </ArcMotionItem>
              ))}
              <FollowThroughDrawer isOpen={showAllActivity}>
                {paymentsOnly.slice(5).map((item, idx) => (
                  <ArcMotionItem
                    key={item.entryId}
                    index={idx}
                    style={{ marginTop: "8px" }}
                  >
                    <span>
                      {formatDate(item.date)} ({item.sourceType?.replace(/_/g, " ")})
                    </span>
                    <strong>{formatRupees(item.amount)}</strong>
                  </ArcMotionItem>
                ))}
              </FollowThroughDrawer>
            </div>
          ) : (
            <small className="muted">No actual payments recorded yet.</small>
          )}
        </div>

        <div>
          <h4 style={{ marginBottom: "8px" }}>Recent business activity</h4>
          {recentActivity.length > 0 ? (
            <div className="item-list">
              {recentActivity.slice(0, 5).map((item, idx) => (
                <ArcMotionItem
                  key={`${item.entryKind}-${item.entryId}`}
                  index={idx}
                >
                  <span>
                    {formatDate(item.date)} ·{" "}
                    {item.entryKind === "inventory_purchase"
                      ? `${item.quantity} ${item.unit} ${item.productName}`
                      : item.entryKind === "actual_payment"
                        ? "Payment received"
                        : `Promise (${item.status})`}
                  </span>
                  <strong>{formatRupees(item.amount)}</strong>
                </ArcMotionItem>
              ))}
              <FollowThroughDrawer isOpen={showAllActivity}>
                {recentActivity.slice(5).map((item, idx) => (
                  <ArcMotionItem
                    key={`${item.entryKind}-${item.entryId}`}
                    index={idx}
                    style={{ marginTop: "8px" }}
                  >
                    <span>
                      {formatDate(item.date)} ·{" "}
                      {item.entryKind === "inventory_purchase"
                        ? `${item.quantity} ${item.unit} ${item.productName}`
                        : item.entryKind === "actual_payment"
                          ? "Payment received"
                          : `Promise (${item.status})`}
                    </span>
                    <strong>{formatRupees(item.amount)}</strong>
                  </ArcMotionItem>
                ))}
              </FollowThroughDrawer>
            </div>
          ) : (
            <small className="muted">No recent activity found.</small>
          )}
        </div>
      </div>
    </FocusStageCard>
  );
}

export default CustomerIntelligenceResult;
