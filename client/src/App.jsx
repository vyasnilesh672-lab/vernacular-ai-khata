import { useEffect, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, MotionConfig, motion } from "framer-motion";
import {
  LayoutDashboard,
  Users,
  Wallet,
  MessageSquare,
  Package,
  ShieldAlert,
  BellRing,
  Settings,
  Bell,
  Languages,
  MoreHorizontal,
  Menu,
  X,
} from "lucide-react";
import {
  getCustomers,
  addCustomer,
  getWhatsAppStatus,
  getReminderCandidates,
} from "./services/api";
import "./App.css";
import {
  ARC_EASE,
  ELASTIC_TAP_SPRING,
  FOLLOW_THROUGH_SPRING,
  MICRO_EASE,
  SMOOTH_EASE,
  TIMINGS,
} from "./motion/motionTokens";
import { MotionButton, PageTransition } from "./motion/motionPrimitives";
import OverviewDashboard from "./components/OverviewDashboard";
import CustomersDirectoryView from "./components/CustomersDirectoryView";
import PaymentLedger from "./components/PaymentLedger";
import AIConversations from "./components/AIConversations";
import InventoryView from "./components/InventoryView";
import CustomerIntelligenceView from "./components/CustomerIntelligenceView";
import RemindersView from "./components/RemindersView";

function App() {
  const [active, setActive] = useState("Overview");
  const [menuOpen, setMenuOpen] = useState(false);
  const [langPopoverOpen, setLangPopoverOpen] = useState(false);
  const scrollPositionsRef = useRef({});

  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [waStatus, setWaStatus] = useState(null);
  const [reminderBadgeCount, setReminderBadgeCount] = useState(0);

  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const [form, setForm] = useState({
    name: "",
    phone: "",
    preferredLanguage: "Hindi",
  });

  const navigateTo = (nextTab) => {
    if (nextTab === active) {
      setMenuOpen(false);
      return;
    }
    scrollPositionsRef.current[active] = window.scrollY;
    setActive(nextTab);
    setMenuOpen(false);
    setLangPopoverOpen(false);
  };

  const handlePageExitComplete = () => {
    const savedY = scrollPositionsRef.current[active] || 0;
    window.scrollTo({ top: savedY, behavior: "auto" });
  };

  const loadCustomers = async () => {
    try {
      setLoading(true);
      setError("");
      const data = await getCustomers();
      setCustomers(data);
    } catch {
      setError("Unable to load customers. Check your backend connection.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let activeFlag = true;
    const init = async () => {
      try {
        const [custData, waData, candData] = await Promise.allSettled([
          getCustomers(),
          getWhatsAppStatus(),
          getReminderCandidates({ upcomingDays: 3 }),
        ]);
        if (!activeFlag) return;
        if (custData.status === "fulfilled") {
          setCustomers(custData.value);
          setError("");
        } else {
          setError("Unable to load customers. Check your backend connection.");
        }
        if (waData.status === "fulfilled") {
          setWaStatus(waData.value);
        }
        if (candData.status === "fulfilled" && Array.isArray(candData.value)) {
          const pendingCount = candData.value.filter((c) => !c.alreadySentToday).length;
          setReminderBadgeCount(pendingCount);
        }
      } finally {
        if (activeFlag) setLoading(false);
      }
    };
    init();
    return () => {
      activeFlag = false;
    };
  }, []);

  const handleAddCustomer = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFormError("");

    try {
      const newCustomer = await addCustomer(form);

      setCustomers((previous) => [newCustomer, ...previous]);
      setForm({
        name: "",
        phone: "",
        preferredLanguage: "Hindi",
      });
      setShowModal(false);
    } catch (err) {
      setFormError(err.message || "Could not add customer.");
    } finally {
      setSaving(false);
    }
  };

  const openAddCustomerModal = () => {
    setFormError("");
    setShowModal(true);
  };

  const navItems = [
    { name: "Overview", icon: LayoutDashboard },
    { name: "AI Conversations", icon: MessageSquare },
    { name: "Payment Ledger", icon: Wallet },
    { name: "Customers", icon: Users },
    { name: "Inventory", icon: Package },
    { name: "Customer Risk", icon: ShieldAlert },
    { name: "Smart Reminders", icon: BellRing },
  ];

  return (
    <MotionConfig reducedMotion="user">
      <div className="app-shell">
        <aside className={`sidebar ${menuOpen ? "show" : ""}`}>
          <div className="brand">
            <motion.div
              className="brand-icon"
              whileHover={{ rotate: [-2, 2, 0], scale: 1.04 }}
              transition={ELASTIC_TAP_SPRING}
            >
              V
            </motion.div>
            <div>
              <h2>Vernacular</h2>
              <span>AI KHATA</span>
            </div>
          </div>

          <div className="workspace-label">WORKSPACE</div>

          <LayoutGroup>
            <nav>
              {navItems.map(({ name, icon: Icon }) => {
                const isActive = active === name;
                return (
                  <motion.button
                    key={name}
                    type="button"
                    className={`nav-item ${isActive ? "active" : ""}`}
                    onClick={() => navigateTo(name)}
                    whileTap={{ scaleX: 0.98, scaleY: 0.96 }}
                    transition={ELASTIC_TAP_SPRING}
                  >
                    {isActive && (
                      <motion.span
                        layoutId="sidebar-active-bg"
                        className="nav-item-bg"
                        transition={FOLLOW_THROUGH_SPRING}
                      />
                    )}
                    <Icon size={19} />
                    <span>{name}</span>
                  </motion.button>
                );
              })}
            </nav>

            <div className="sidebar-bottom">
              <motion.button
                type="button"
                className={`nav-item ${active === "Settings" ? "active" : ""}`}
                onClick={() => navigateTo("Settings")}
                whileTap={{ scaleX: 0.98, scaleY: 0.96 }}
                transition={ELASTIC_TAP_SPRING}
              >
                {active === "Settings" && (
                  <motion.span
                    layoutId="sidebar-active-bg"
                    className="nav-item-bg"
                    transition={FOLLOW_THROUGH_SPRING}
                  />
                )}
                <Settings size={19} />
                <span>Settings</span>
              </motion.button>

              <div className="profile">
                <div className="avatar">NV</div>
                <div>
                  <strong>My Business</strong>
                  <small>Vendor account</small>
                </div>
                <MoreHorizontal size={19} />
              </div>
            </div>
          </LayoutGroup>
        </aside>

        <main className="main-content">
          <header className="topbar">
            <button
              type="button"
              className="mobile-menu"
              aria-label="Toggle navigation menu"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              <Menu />
            </button>

            <div className="breadcrumb">
              Workspace / <strong>{active}</strong>
            </div>

            <div className="top-actions" style={{ position: "relative" }}>
              <MotionButton
                className="text-btn"
                onClick={() => setLangPopoverOpen((prev) => !prev)}
                ariaLabel="Supported voice languages"
              >
                <Languages size={17} /> Gujarati · Hindi · English
              </MotionButton>

              <AnimatePresence>
                {langPopoverOpen && (
                  <motion.div
                    initial={{ opacity: 0, x: 10, y: -8, scale: 0.95 }}
                    animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
                    exit={{ opacity: 0, x: 6, y: -6, scale: 0.96 }}
                    transition={FOLLOW_THROUGH_SPRING}
                    style={{
                      position: "absolute",
                      top: "44px",
                      right: "48px",
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: "12px",
                      padding: "12px 14px",
                      boxShadow: "0 14px 32px rgba(23, 100, 95, 0.14)",
                      zIndex: 50,
                      minWidth: "215px",
                      fontSize: "12px",
                      transformOrigin: "top right",
                    }}
                  >
                    <strong style={{ display: "block", marginBottom: "6px" }}>
                      Supported Voice Languages
                    </strong>
                    <div className="muted">Gujarati (gu-IN)</div>
                    <div className="muted">Hindi & Hinglish (hi-IN)</div>
                    <div className="muted">Indian English (en-IN)</div>
                  </motion.div>
                )}
              </AnimatePresence>

              <motion.button
                type="button"
                className="notification"
                aria-label="Open smart reminders"
                onClick={() => navigateTo("Smart Reminders")}
                whileHover={{ rotate: [-6, 6, 0], scale: 1.06 }}
                whileTap={{ scale: 0.92 }}
                transition={{ duration: TIMINGS.micro, ease: MICRO_EASE }}
              >
                <Bell size={19} />
                {reminderBadgeCount > 0 ? (
                  <motion.span
                    className="notif-badge-count"
                    initial={{ scale: 0.4, x: 4, y: -4 }}
                    animate={{ scale: 1, x: 0, y: 0 }}
                    transition={{ duration: TIMINGS.card, ease: ARC_EASE }}
                  >
                    {reminderBadgeCount}
                  </motion.span>
                ) : (
                  <i />
                )}
              </motion.button>
              <div className="avatar top-avatar">NV</div>
            </div>
          </header>

          <section className="page-content">
            <AnimatePresence mode="wait" onExitComplete={handlePageExitComplete}>
              <PageTransition key={active} pageKey={active}>
                {active === "Payment Ledger" ? (
                  <PaymentLedger />
                ) : active === "AI Conversations" ? (
                  <AIConversations />
                ) : active === "Customers" ? (
                  <CustomersDirectoryView
                    customers={customers}
                    loading={loading}
                    error={error}
                    onReload={loadCustomers}
                    onOpenAddModal={openAddCustomerModal}
                  />
                ) : active === "Inventory" ? (
                  <InventoryView />
                ) : active === "Customer Risk" ? (
                  <CustomerIntelligenceView />
                ) : active === "Smart Reminders" ? (
                  <RemindersView />
                ) : active === "Settings" ? (
                  <div className="panel" style={{ maxWidth: "700px" }}>
                    <div className="panel-heading">
                      <div>
                        <h3>Workspace & Integration Status</h3>
                        <p>Live backend configuration status (secrets never exposed).</p>
                      </div>
                    </div>
                    <div className="item-list">
                      <div className="item-row">
                        <div>
                          <strong>WhatsApp Business Cloud API</strong>
                          <small>
                            {waStatus?.configured
                              ? `Connected (${waStatus.apiVersion})`
                              : "Running on Mock Adapter — add WhatsApp credentials to server/.env to enable live Cloud API delivery."}
                          </small>
                        </div>
                        <span
                          className={
                            waStatus?.configured ? "status paid" : "status pending"
                          }
                        >
                          {waStatus?.configured ? "Configured" : "Mock Mode"}
                        </span>
                      </div>
                      <div className="item-row">
                        <div>
                          <strong>Registered Customers</strong>
                          <small>Active MongoDB customer directory count</small>
                        </div>
                        <strong>{customers.length}</strong>
                      </div>
                    </div>
                  </div>
                ) : (
                  <OverviewDashboard
                    customers={customers}
                    onNavigate={navigateTo}
                    onAddCustomer={openAddCustomerModal}
                  />
                )}
              </PageTransition>
            </AnimatePresence>
          </section>
        </main>

        <AnimatePresence>
          {showModal && (
            <motion.div
              className="modal-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: TIMINGS.snappy, ease: MICRO_EASE } }}
              transition={{ duration: TIMINGS.overlay, ease: SMOOTH_EASE }}
              onClick={() => !saving && setShowModal(false)}
            >
              <motion.div
                className="customer-modal"
                initial={{ opacity: 0, scale: 0.94, y: 18 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 8, transition: { duration: TIMINGS.snappy, ease: MICRO_EASE } }}
                transition={FOLLOW_THROUGH_SPRING}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="modal-heading">
                  <div>
                    <h2>Add new customer</h2>
                    <p>Save a customer to your digital khata.</p>
                  </div>

                  <button
                    type="button"
                    className="modal-close"
                    onClick={() => setShowModal(false)}
                    disabled={saving}
                  >
                    <X size={20} />
                  </button>
                </div>

                <form onSubmit={handleAddCustomer}>
                  <label>Customer name</label>
                  <input
                    type="text"
                    placeholder="e.g. Rahul Patel"
                    value={form.name}
                    onChange={(e) =>
                      setForm({ ...form, name: e.target.value })
                    }
                    required
                  />

                  <label>Phone number</label>
                  <input
                    type="tel"
                    placeholder="e.g. 9876543210"
                    value={form.phone}
                    onChange={(e) =>
                      setForm({ ...form, phone: e.target.value })
                    }
                    required
                  />

                  <label>Preferred language</label>
                  <select
                    value={form.preferredLanguage}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        preferredLanguage: e.target.value,
                      })
                    }
                  >
                    <option value="Hindi">Hindi</option>
                    <option value="Gujarati">Gujarati</option>
                    <option value="English">English</option>
                  </select>

                  {formError && <p className="form-error">{formError}</p>}

                  <MotionButton
                    type="submit"
                    className="primary-btn modal-submit"
                    disabled={saving}
                    anticipate
                  >
                    {saving ? "Saving..." : "Save customer"}
                  </MotionButton>
                </form>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}

export default App;
