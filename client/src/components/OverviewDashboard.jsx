import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Wallet,
  CheckCircle2,
  Clock,
  Users,
  Package,
  ShieldAlert,
  BellRing,
  MessageSquare,
  RefreshCw,
  ArrowUpRight,
  Plus,
} from "lucide-react";
import {
  getCommitments,
  getInventoryProducts,
  getInventoryTransformations,
  getInventoryPnl,
  getHighestOutstandingCustomers,
  getOverdueCustomers,
  getReminderCandidates,
  getReminders,
  getWhatsAppStatus,
  getRecentCommands,
} from "../services/api";
import { SMOOTH_EASE, TIMINGS } from "../motion/motionTokens";
import {
  MotionButton,
  MotionSectionCard,
  LoadingCrossfade,
  StaggerGrid,
  StaggerCard,
  ArcMotionItem,
  AnimatedProgressBar,
  AnimatedValue,
  StatusPill,
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

const getTodayIST = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

const formatHeaderDate = () =>
  new Date()
    .toLocaleDateString("en-IN", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "Asia/Kolkata",
    })
    .toUpperCase();

function OverviewDashboard({ customers, onNavigate, onAddCustomer }) {
  const [loading, setLoading] = useState(true);
  const [sectionErrors, setSectionErrors] = useState([]);
  const [data, setData] = useState({
    commitments: [],
    products: [],
    transformations: [],
    pnl: null,
    highestOutstanding: [],
    overdueCustomers: [],
    reminderCandidates: [],
    reminders: [],
    waStatus: null,
    recentCommands: [],
  });

  const loadDashboard = async () => {
    setLoading(true);
    const errors = [];

    const tasks = [
      ["commitments", getCommitments()],
      ["products", getInventoryProducts()],
      ["transformations", getInventoryTransformations()],
      ["pnl", getInventoryPnl()],
      ["highestOutstanding", getHighestOutstandingCustomers({ limit: 5 })],
      ["overdueCustomers", getOverdueCustomers({ limit: 5 })],
      ["reminderCandidates", getReminderCandidates({ upcomingDays: 3 })],
      ["reminders", getReminders()],
      ["waStatus", getWhatsAppStatus()],
      ["recentCommands", getRecentCommands(6)],
    ];

    const settled = await Promise.allSettled(tasks.map(([, p]) => p));
    const next = {
      commitments: [],
      products: [],
      transformations: [],
      pnl: null,
      highestOutstanding: [],
      overdueCustomers: [],
      reminderCandidates: [],
      reminders: [],
      waStatus: null,
      recentCommands: [],
    };

    settled.forEach((res, idx) => {
      const key = tasks[idx][0];
      if (res.status === "fulfilled") {
        if (key === "highestOutstanding" || key === "overdueCustomers") {
          next[key] = res.value?.data || [];
        } else {
          next[key] = res.value;
        }
      } else {
        errors.push(`${key}: ${res.reason?.message || "failed to load"}`);
      }
    });

    setData(next);
    setSectionErrors(errors);
    setLoading(false);
  };

  useEffect(() => {
    let active = true;
    const init = async () => {
      const tasks = [
        ["commitments", getCommitments()],
        ["products", getInventoryProducts()],
        ["transformations", getInventoryTransformations()],
        ["pnl", getInventoryPnl()],
        ["highestOutstanding", getHighestOutstandingCustomers({ limit: 5 })],
        ["overdueCustomers", getOverdueCustomers({ limit: 5 })],
        ["reminderCandidates", getReminderCandidates({ upcomingDays: 3 })],
        ["reminders", getReminders()],
        ["waStatus", getWhatsAppStatus()],
        ["recentCommands", getRecentCommands(6)],
      ];
      const settled = await Promise.allSettled(tasks.map(([, p]) => p));
      if (!active) return;

      const errors = [];
      const next = {
        commitments: [],
        products: [],
        transformations: [],
        pnl: null,
        highestOutstanding: [],
        overdueCustomers: [],
        reminderCandidates: [],
        reminders: [],
        waStatus: null,
        recentCommands: [],
      };
      settled.forEach((res, idx) => {
        const key = tasks[idx][0];
        if (res.status === "fulfilled") {
          if (key === "highestOutstanding" || key === "overdueCustomers") {
            next[key] = res.value?.data || [];
          } else {
            next[key] = res.value;
          }
        } else {
          errors.push(`${key}: ${res.reason?.message || "failed to load"}`);
        }
      });
      setData(next);
      setSectionErrors(errors);
      setLoading(false);
    };
    init();
    return () => {
      active = false;
    };
  }, []);

  const todayISO = getTodayIST();
  const paidRecords = data.commitments.filter((c) => c.paymentStatus === "Paid");
  const unpaidRecords = data.commitments.filter((c) => c.paymentStatus !== "Paid");
  const overdueRecords = unpaidRecords.filter(
    (c) => c.promisedDate && new Date(c.promisedDate).toISOString().slice(0, 10) < todayISO
  );

  const paymentsReceived = paidRecords.reduce((s, c) => s + (c.amount || 0), 0);
  const totalReceivables = unpaidRecords.reduce((s, c) => s + (c.amount || 0), 0);
  const overduePaymentsAmount = overdueRecords.reduce(
    (s, c) => s + (c.amount || 0),
    0
  );
  const upcomingReceivablesAmount = Math.max(
    0,
    totalReceivables - overduePaymentsAmount
  );

  const lowStockProducts = data.products.filter((p) => p.isLowStock);
  const knownStockValue = data.products.reduce((sum, p) => {
    const unitVal = p.purchaseCost ?? p.sellingPrice ?? null;
    return unitVal !== null ? sum + p.currentStock * unitVal : sum;
  }, 0);
  const productsMissingValuation = data.products.filter(
    (p) => p.purchaseCost === null && p.sellingPrice === null
  ).length;

  const upcomingCandidates = data.reminderCandidates.filter(
    (c) => c.reminderType === "upcoming" || c.reminderType === "due_today"
  );
  const overdueCandidates = data.reminderCandidates.filter(
    (c) => c.reminderType === "overdue"
  );

  const totalCashflowVolume =
    paymentsReceived + upcomingReceivablesAmount + overduePaymentsAmount;

  const maxProductStock = Math.max(
    ...data.products.map((p) => p.currentStock || 0),
    0
  );

  return (
    <>
      <motion.div
        className="welcome-row"
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: TIMINGS.page, ease: SMOOTH_EASE }}
      >
        <div>
          <div className="eyebrow">{formatHeaderDate()}</div>
          <h1>Business Overview</h1>
          <p>Live khata receivables, inventory, customer risk, reminders, and AI activity.</p>
        </div>

        <div className="header-actions">
          <MotionButton
            className="secondary-btn"
            onClick={loadDashboard}
            disabled={loading}
          >
            <RefreshCw size={16} className={loading ? "icon-spin" : ""} />{" "}
            {loading ? "Refreshing" : "Refresh"}
          </MotionButton>
          <MotionButton
            className="teal-btn"
            onClick={() => onNavigate("AI Conversations")}
            anticipate
          >
            <MessageSquare size={16} /> AI Command
          </MotionButton>
          <MotionButton
            className="primary-btn"
            onClick={onAddCustomer}
            anticipate
          >
            <Plus size={17} /> Add customer
          </MotionButton>
        </div>
      </motion.div>

      <ErrorFeedbackBanner
        message={
          sectionErrors.length > 0
            ? `Some live sections could not load: ${sectionErrors.join(" · ")}`
            : ""
        }
        onRetry={loadDashboard}
      />

      <LoadingCrossfade
        loading={loading}
        sectionKey="kpi-stats"
        skeleton={<SkeletonStatsGrid count={4} />}
      >
        <StaggerGrid>
          <StaggerCard>
            <div className="stat-top">
              <span>Total receivables</span>
              <Clock />
            </div>
            <h2>
              <AnimatedValue value={totalReceivables} format={money} />
            </h2>
            <small className="muted">{unpaidRecords.length} unpaid commitment(s)</small>
          </StaggerCard>

          <StaggerCard>
            <div className="stat-top">
              <span>Payments received</span>
              <CheckCircle2 />
            </div>
            <h2>
              <AnimatedValue value={paymentsReceived} format={money} />
            </h2>
            <small className="success-text">{paidRecords.length} paid record(s)</small>
          </StaggerCard>

          <StaggerCard>
            <div className="stat-top">
              <span>Overdue payments</span>
              <Wallet />
            </div>
            <h2>
              <AnimatedValue value={overduePaymentsAmount} format={money} />
            </h2>
            <small className={overdueRecords.length > 0 ? "danger-text" : "muted"}>
              {overdueRecords.length} overdue commitment(s)
            </small>
          </StaggerCard>

          <StaggerCard>
            <div className="stat-top">
              <span>Customers</span>
              <Users />
            </div>
            <h2>
              <AnimatedValue value={customers.length} />
            </h2>
            <small className="muted">{data.overdueCustomers.length} with overdue balance</small>
          </StaggerCard>
        </StaggerGrid>
      </LoadingCrossfade>

      <div className="dashboard-grid-2">
        <MotionSectionCard>
          <div className="panel-heading">
            <div>
              <h3>Receivables & collections</h3>
              <p>Live breakdown from confirmed ledger records.</p>
            </div>
            <MotionButton
              className="text-btn"
              onClick={() => onNavigate("Payment Ledger")}
            >
              Open ledger <ArrowUpRight size={15} />
            </MotionButton>
          </div>

          <LoadingCrossfade
            loading={loading}
            sectionKey="receivables"
            skeleton={<SkeletonList rows={3} />}
          >
            {totalCashflowVolume > 0 ? (
              <div className="chart-card">
                <div className="bar-row">
                  <div className="bar-label">
                    <span>Payments received</span>
                    <strong>{money(paymentsReceived)}</strong>
                  </div>
                  <AnimatedProgressBar
                    percent={Math.round((paymentsReceived / totalCashflowVolume) * 100)}
                    variant="teal"
                  />
                </div>

                <div className="bar-row">
                  <div className="bar-label">
                    <span>Upcoming / due receivables</span>
                    <strong>{money(upcomingReceivablesAmount)}</strong>
                  </div>
                  <AnimatedProgressBar
                    percent={Math.round((upcomingReceivablesAmount / totalCashflowVolume) * 100)}
                    variant="amber"
                  />
                </div>

                <div className="bar-row">
                  <div className="bar-label">
                    <span>Overdue receivables</span>
                    <strong>{money(overduePaymentsAmount)}</strong>
                  </div>
                  <AnimatedProgressBar
                    percent={Math.round((overduePaymentsAmount / totalCashflowVolume) * 100)}
                    variant="coral"
                  />
                </div>
              </div>
            ) : (
              <EmptyStateBox message="No payment commitments recorded yet. Start via AI Conversations." />
            )}
          </LoadingCrossfade>
        </MotionSectionCard>

        <MotionSectionCard>
          <div className="panel-heading">
            <div>
              <h3>Inventory overview</h3>
              <p>Products, stock levels, transformations, and valuation.</p>
            </div>
            <MotionButton
              className="text-btn"
              onClick={() => onNavigate("Inventory")}
            >
              Manage inventory <ArrowUpRight size={15} />
            </MotionButton>
          </div>

          <LoadingCrossfade
            loading={loading}
            sectionKey="inventory"
            skeleton={<SkeletonList rows={3} />}
          >
            <>
              <div className="item-list" style={{ marginBottom: "12px" }}>
                <ArcMotionItem index={0}>
                  <div>
                    <strong>{data.products.length} Active product(s)</strong>
                    <small>{lowStockProducts.length} below minimum threshold</small>
                  </div>
                  <StatusPill statusKey={data.transformations.length} className="status promised">
                    {data.transformations.length} Transformation(s)
                  </StatusPill>
                </ArcMotionItem>

                <ArcMotionItem index={1}>
                  <div>
                    <strong>Estimated stock value</strong>
                    <small>
                      {productsMissingValuation > 0
                        ? `${productsMissingValuation} product(s) missing cost/price`
                        : "Based on recorded purchase cost / selling price"}
                    </small>
                  </div>
                  <strong>{money(knownStockValue)}</strong>
                </ArcMotionItem>
              </div>

              {data.products.length > 0 && maxProductStock > 0 ? (
                <div className="chart-card" style={{ marginBottom: 0 }}>
                  {data.products.slice(0, 3).map((p) => (
                    <div className="bar-row" key={p._id}>
                      <div className="bar-label">
                        <span>{p.name}</span>
                        <strong>
                          {p.currentStock} {p.unit}
                        </strong>
                      </div>
                      <AnimatedProgressBar
                        percent={Math.max(4, Math.round((p.currentStock / maxProductStock) * 100))}
                        variant={p.isLowStock ? "coral" : "teal"}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyStateBox message="No inventory products yet. Add products or record a purchase via AI." />
              )}
            </>
          </LoadingCrossfade>
        </MotionSectionCard>
      </div>

      <div className="dashboard-grid-2">
        <MotionSectionCard>
          <div className="panel-heading">
            <div>
              <h3>Customer intelligence</h3>
              <p>Highest outstanding balances and estimated risk indicators.</p>
            </div>
            <MotionButton
              className="text-btn"
              onClick={() => onNavigate("Customer Risk")}
            >
              View risk report <ArrowUpRight size={15} />
            </MotionButton>
          </div>

          <LoadingCrossfade
            loading={loading}
            sectionKey="customer-intelligence"
            skeleton={<SkeletonList rows={3} />}
          >
            {data.highestOutstanding.length > 0 ? (
              <div className="item-list">
                {data.highestOutstanding.slice(0, 4).map((entry, idx) => {
                  const risk = entry.riskAssessment || {};
                  const badgeClass =
                    risk.riskLevel === "High"
                      ? "status overdue"
                      : risk.riskLevel === "Moderate"
                        ? "status pending"
                        : risk.riskLevel === "Low"
                          ? "status paid"
                          : "status promised";
                  return (
                    <ArcMotionItem key={entry.customer._id} index={idx}>
                      <div>
                        <strong>{entry.customer.name}</strong>
                        <small>
                          {entry.financialProfile.overdueCommitmentsCount} overdue ·{" "}
                          {entry.pattern?.trend?.replace(/_/g, " ") || "history"}
                        </small>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <strong>{money(entry.financialProfile.outstandingBalance)}</strong>
                        <StatusPill
                          statusKey={`${entry.customer._id}-${risk.riskLevel}-${risk.riskScore}`}
                          className={badgeClass}
                        >
                          Est.{" "}
                          {risk.riskScore !== null && risk.riskScore !== undefined
                            ? `${risk.riskLevel} (${risk.riskScore})`
                            : risk.riskLevel}
                        </StatusPill>
                      </div>
                    </ArcMotionItem>
                  );
                })}
              </div>
            ) : (
              <EmptyStateBox message="No outstanding customer balances right now." />
            )}
          </LoadingCrossfade>
        </MotionSectionCard>

        <MotionSectionCard>
          <div className="panel-heading">
            <div>
              <h3>Smart reminders & WhatsApp</h3>
              <p>Upcoming, overdue reminders and delivery tracking.</p>
            </div>
            <MotionButton
              className="text-btn"
              onClick={() => onNavigate("Smart Reminders")}
            >
              Manage reminders <ArrowUpRight size={15} />
            </MotionButton>
          </div>

          <LoadingCrossfade
            loading={loading}
            sectionKey="reminders"
            skeleton={<SkeletonList rows={3} />}
          >
            <div className="item-list">
              <ArcMotionItem index={0}>
                <div>
                  <strong>WhatsApp adapter status</strong>
                  <small>
                    {data.waStatus?.configured
                      ? `Cloud API (${data.waStatus.apiVersion})`
                      : "Mock adapter active (credentials unset)"}
                  </small>
                </div>
                <StatusPill
                  statusKey={data.waStatus?.mode}
                  className={
                    data.waStatus?.configured ? "status paid" : "status pending"
                  }
                >
                  {data.waStatus?.configured ? "Cloud API" : "Mock Mode"}
                </StatusPill>
              </ArcMotionItem>

              <ArcMotionItem index={1}>
                <div>
                  <strong>Due & upcoming reminders</strong>
                  <small>
                    {upcomingCandidates.length} upcoming/due today ·{" "}
                    {overdueCandidates.length} overdue
                  </small>
                </div>
                <span className="status promised">
                  <BellRing size={12} /> {data.reminderCandidates.length} total
                </span>
              </ArcMotionItem>

              {data.reminders.length > 0 ? (
                data.reminders.slice(0, 2).map((rem, idx) => (
                  <ArcMotionItem key={rem._id} index={idx + 2}>
                    <div>
                      <strong>{rem.customer?.name || "Customer"}</strong>
                      <small>
                        {rem.reminderType} · {money(rem.outstandingAmountSnapshot)} ·{" "}
                        {rem.language}
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
                ))
              ) : (
                <EmptyStateBox message="No reminders sent yet." />
              )}
            </div>
          </LoadingCrossfade>
        </MotionSectionCard>
      </div>

      <MotionSectionCard style={{ marginBottom: "18px" }}>
        <div className="panel-heading">
          <div>
            <h3>Recent AI activity</h3>
            <p>Latest voice & typed commands, payment updates, inventory commands, and customer queries.</p>
          </div>
          <MotionButton
            className="text-btn"
            onClick={() => onNavigate("AI Conversations")}
          >
            Open AI assistant <ArrowUpRight size={15} />
          </MotionButton>
        </div>

        <LoadingCrossfade
          loading={loading}
          sectionKey="recent-ai"
          skeleton={<SkeletonList rows={3} />}
        >
          {data.recentCommands.length > 0 ? (
            <div className="item-list">
              {data.recentCommands.map((sess, idx) => {
                const firstVendorTurn =
                  sess.turns?.find((t) => t.role === "vendor")?.text ||
                  sess.draft?.originalMessage ||
                  sess.commandCategory;
                const badgeClass =
                  sess.status === "executed"
                    ? "status paid"
                    : sess.status === "rejected" || sess.status === "expired"
                      ? "status overdue"
                      : "status pending";
                return (
                  <ArcMotionItem key={sess.sessionId} index={idx}>
                    <div>
                      <strong>{firstVendorTurn}</strong>
                      <small>
                        {sess.commandCategory.replace(/_/g, " ")} ·{" "}
                        {sess.isReadOnly ? "Read-only query" : "Ledger action"}
                      </small>
                    </div>
                    <StatusPill statusKey={sess.status} className={badgeClass}>
                      {sess.status.replace(/_/g, " ")}
                    </StatusPill>
                  </ArcMotionItem>
                );
              })}
            </div>
          ) : (
            <EmptyStateBox message="No AI commands yet. Try speaking or typing in AI Conversations." />
          )}
        </LoadingCrossfade>
      </MotionSectionCard>

      <footer>
        <span>© {new Date().getFullYear()} Vernacular AI Khata</span>
        <span>
          <Package size={12} /> <ShieldAlert size={12} /> Built for local Indian businesses
        </span>
      </footer>
    </>
  );
}

export default OverviewDashboard;
