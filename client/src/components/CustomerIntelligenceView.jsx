import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ShieldAlert, RefreshCw } from "lucide-react";
import {
  getHighestOutstandingCustomers,
  getOverdueCustomers,
  getCustomerPatterns,
  getCustomerRisk,
  getCustomerPaymentHistory,
} from "../services/api";
import { FOLLOW_THROUGH_SPRING } from "../motion/motionTokens";
import {
  MotionButton,
  ArcMotionItem,
  StatusPill,
  ErrorFeedbackBanner,
  SkeletonList,
  EmptyStateBox,
} from "../motion/motionPrimitives";
import CustomerIntelligenceResult from "./CustomerIntelligenceResult";

const money = (amount) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount || 0);

function CustomerIntelligenceView() {
  const [highest, setHighest] = useState([]);
  const [overdue, setOverdue] = useState([]);
  const [patterns, setPatterns] = useState([]);
  const [trendFilter, setTrendFilter] = useState("");
  const [selectedProfile, setSelectedProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState("");

  const loadIntelligence = async (trend = trendFilter) => {
    try {
      setLoading(true);
      setError("");
      const [hRes, oRes, pRes] = await Promise.all([
        getHighestOutstandingCustomers({ limit: 10 }),
        getOverdueCustomers({ limit: 10 }),
        getCustomerPatterns({ trend: trend || undefined, limit: 10 }),
      ]);
      setHighest(hRes.data || []);
      setOverdue(oRes.data || []);
      setPatterns(pRes.data || []);
    } catch (err) {
      setError(err.message || "Unable to load customer intelligence.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    const init = async () => {
      try {
        const [hRes, oRes, pRes] = await Promise.all([
          getHighestOutstandingCustomers({ limit: 10 }),
          getOverdueCustomers({ limit: 10 }),
          getCustomerPatterns({ limit: 10 }),
        ]);
        if (active) {
          setHighest(hRes.data || []);
          setOverdue(oRes.data || []);
          setPatterns(pRes.data || []);
          setError("");
        }
      } catch (err) {
        if (active) setError(err.message || "Unable to load customer intelligence.");
      } finally {
        if (active) setLoading(false);
      }
    };
    init();
    return () => {
      active = false;
    };
  }, []);

  const inspectCustomer = async (customerId) => {
    try {
      setLoadingDetail(true);
      setError("");
      const [riskData, historyRes] = await Promise.all([
        getCustomerRisk(customerId),
        getCustomerPaymentHistory(customerId, { limit: 10 }),
      ]);

      const listEntry =
        highest.find((h) => h.customer._id === customerId) ||
        overdue.find((o) => o.customer._id === customerId);

      setSelectedProfile({
        customer: riskData.customer,
        riskAssessment: riskData.riskAssessment,
        pattern: riskData.pattern,
        insights: riskData.insights,
        financialProfile: {
          ...(listEntry?.financialProfile || {}),
          totalPurchases: historyRes.totals?.totalPurchases || 0,
          totalAmountPaid: historyRes.totals?.totalAmountPaid || 0,
          outstandingBalance: historyRes.totals?.outstandingBalance || 0,
          recentPaymentActivity: historyRes.data || [],
        },
      });
    } catch (err) {
      setError(err.message || "Failed to load risk assessment.");
    } finally {
      setLoadingDetail(false);
    }
  };

  const renderRiskBadge = (risk) => {
    const cls =
      risk?.riskLevel === "High"
        ? "status overdue"
        : risk?.riskLevel === "Moderate"
          ? "status pending"
          : risk?.riskLevel === "Low"
            ? "status paid"
            : "status promised";
    return (
      <StatusPill statusKey={risk?.riskLevel || "insufficient"} className={cls}>
        Est.{" "}
        {risk?.riskScore !== null && risk?.riskScore !== undefined
          ? `${risk.riskLevel} (${risk.riskScore}/100)`
          : risk?.riskLevel || "Insufficient history"}
      </StatusPill>
    );
  };

  return (
    <>
      <div className="welcome-row">
        <div>
          <div className="eyebrow">EXPLAINABLE UDHAAR RISK ENGINE</div>
          <h1>Customer Intelligence</h1>
          <p>Highest outstanding balances, overdue commitments, payment patterns, and estimated risk scores.</p>
        </div>

        <MotionButton
          className="secondary-btn"
          onClick={() => loadIntelligence()}
          disabled={loading}
        >
          <RefreshCw size={16} className={loading ? "icon-spin" : ""} />{" "}
          {loading ? "Refreshing" : "Refresh"}
        </MotionButton>
      </div>

      <ErrorFeedbackBanner
        message={error}
        onRetry={() => loadIntelligence()}
        onDismiss={() => setError("")}
      />

      {loadingDetail && (
        <div className="panel" style={{ marginBottom: "18px" }}>
          <SkeletonList rows={2} />
        </div>
      )}

      <AnimatePresence mode="wait">
        {selectedProfile && !loadingDetail && (
          <motion.div
            key={selectedProfile.customer._id}
            initial={{ opacity: 0, y: 10, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.99 }}
            transition={FOLLOW_THROUGH_SPRING}
          >
            <CustomerIntelligenceResult result={selectedProfile} />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="dashboard-grid-2">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h3>Highest outstanding balances</h3>
              <p>Ranked by unpaid confirmed receivables.</p>
            </div>
          </div>

          {loading ? (
            <SkeletonList rows={3} />
          ) : highest.length > 0 ? (
            <div className="item-list">
              {highest.map((entry, idx) => (
                <ArcMotionItem key={entry.customer._id} index={idx}>
                  <div>
                    <strong>{entry.customer.name}</strong>
                    <small>
                      Paid: {money(entry.financialProfile.totalAmountPaid)} ·{" "}
                      {entry.financialProfile.completedCommitmentsCount} completed
                    </small>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <strong>{money(entry.financialProfile.outstandingBalance)}</strong>
                    <div
                      style={{
                        marginTop: "4px",
                        display: "flex",
                        gap: "8px",
                        alignItems: "center",
                        justifyContent: "flex-end",
                      }}
                    >
                      {renderRiskBadge(entry.riskAssessment)}
                      <MotionButton
                        className="text-btn"
                        onClick={() => inspectCustomer(entry.customer._id)}
                      >
                        Explain
                      </MotionButton>
                    </div>
                  </div>
                </ArcMotionItem>
              ))}
            </div>
          ) : (
            <EmptyStateBox message="No outstanding customer balances found." />
          )}
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <h3>Overdue customers</h3>
              <p>Customers with commitments past their promised date.</p>
            </div>
          </div>

          {loading ? (
            <SkeletonList rows={3} />
          ) : overdue.length > 0 ? (
            <div className="item-list">
              {overdue.map((entry, idx) => (
                <ArcMotionItem key={entry.customer._id} index={idx}>
                  <div>
                    <strong>{entry.customer.name}</strong>
                    <small>
                      {entry.financialProfile.overdueCommitmentsCount} overdue ·{" "}
                      {entry.financialProfile.brokenPromisesCount} broken promise(s)
                    </small>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <strong className="danger-text">
                      {money(entry.financialProfile.overdueOutstandingAmount)}
                    </strong>
                    <div
                      style={{
                        marginTop: "4px",
                        display: "flex",
                        gap: "8px",
                        justifyContent: "flex-end",
                      }}
                    >
                      {renderRiskBadge(entry.riskAssessment)}
                      <MotionButton
                        className="text-btn"
                        onClick={() => inspectCustomer(entry.customer._id)}
                      >
                        Explain
                      </MotionButton>
                    </div>
                  </div>
                </ArcMotionItem>
              ))}
            </div>
          ) : (
            <EmptyStateBox message="No overdue customers right now." />
          )}
        </section>
      </div>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h3>Payment pattern trends</h3>
            <p>Improving or worsening customer behavior across matured commitments.</p>
          </div>

          <select
            className="status-select"
            value={trendFilter}
            onChange={(e) => {
              const next = e.target.value;
              setTrendFilter(next);
              loadIntelligence(next);
            }}
          >
            <option value="">Improving & worsening</option>
            <option value="improving">Improving only</option>
            <option value="worsening">Worsening only</option>
            <option value="stable">Stable</option>
          </select>
        </div>

        {loading ? (
          <SkeletonList rows={2} />
        ) : patterns.length > 0 ? (
          <div className="item-list">
            {patterns.map((entry, idx) => (
              <ArcMotionItem key={entry.customer._id} index={idx}>
                <div>
                  <strong>{entry.customer.name}</strong>
                  <small>{entry.pattern.explanation}</small>
                </div>
                <StatusPill
                  statusKey={entry.pattern.trend}
                  className={
                    entry.pattern.trend === "worsening"
                      ? "status overdue"
                      : entry.pattern.trend === "improving"
                        ? "status paid"
                        : "status promised"
                  }
                  style={{ textTransform: "capitalize" }}
                >
                  <ShieldAlert size={12} />{" "}
                  {entry.pattern.trend.replace(/_/g, " ")}
                </StatusPill>
              </ArcMotionItem>
            ))}
          </div>
        ) : (
          <EmptyStateBox message="No customers currently show an improving or worsening pattern (requires at least 3 matured commitments)." />
        )}
      </section>
    </>
  );
}

export default CustomerIntelligenceView;
