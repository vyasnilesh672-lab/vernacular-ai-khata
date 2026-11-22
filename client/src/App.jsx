
import { useEffect, useState } from "react";
import {
  LayoutDashboard, Users, Wallet, MessageSquare,
  Settings, Search, Bell, Plus, ArrowUpRight,
  CheckCircle2, Languages, MoreHorizontal, Menu,
  X, LoaderCircle
} from "lucide-react";
import {
  getCustomers,
  addCustomer,
  extractPaymentDetails,
} from "./services/api";
import "./App.css";
import PaymentLedger from "./components/PaymentLedger";
import AIConversations from "./components/AIConversations";

const money = (amount) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);

function App() {
  const [active, setActive] = useState("Overview");
  const [search, setSearch] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const [form, setForm] = useState({
    name: "",
    phone: "",
    preferredLanguage: "Hindi",
  });

  const loadCustomers = async () => {
    try {
      setError("");
      const data = await getCustomers();
      setCustomers(data);
    } catch (err) {
      setError("Unable to load customers. Check your backend connection.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCustomers();
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

  const filteredCustomers = customers.filter((customer) => {
    const query = search.toLowerCase();

    return (
      customer.name.toLowerCase().includes(query) ||
      customer.phone.includes(query)
    );
  });

  const languageCount = (language) =>
    customers.filter((customer) =>
      customer.preferredLanguage === language
    ).length;

  const navItems = [
    { name: "Overview", icon: LayoutDashboard },
    { name: "Customers", icon: Users },
    { name: "Payment Ledger", icon: Wallet },
    { name: "AI Conversations", icon: MessageSquare },
  ];

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? "show" : ""}`}>
        <div className="brand">
          <div className="brand-icon">V</div>
          <div>
            <h2>Vernacular</h2>
            <span>AI KHATA</span>
          </div>
        </div>

        <div className="workspace-label">WORKSPACE</div>

        <nav>
          {navItems.map(({ name, icon: Icon }) => (
            <button
              key={name}
              className={`nav-item ${active === name ? "active" : ""}`}
              onClick={() => {
                setActive(name);
                setMenuOpen(false);
              }}
            >
              <Icon size={19} />
              <span>{name}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <button
            className="nav-item"
            onClick={() => setActive("Settings")}
          >
            <Settings size={19} />
            <span>Settings</span>
          </button>

          <div className="profile">
            <div className="avatar">NV</div>
            <div>
              <strong>My Business</strong>
              <small>Vendor account</small>
            </div>
            <MoreHorizontal size={19} />
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <button
            className="mobile-menu"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <Menu />
          </button>

          <div className="breadcrumb">
            Workspace / <strong>{active}</strong>
          </div>

          <div className="top-actions">
            <div className="language">
              <Languages size={17} /> English
            </div>
            <button className="notification">
              <Bell size={19} />
              <i />
            </button>
            <div className="avatar top-avatar">NV</div>
          </div>
        </header>

        <section className="page-content">
                 {active === "Payment Ledger" ? (
  <PaymentLedger />
) : active === "AI Conversations" ? (
  <AIConversations />
) : (
  <>
          <div className="welcome-row">
            <div>
              <div className="eyebrow">SUNDAY, NOVEMBER 22, 2026</div>
              <h1>Good morning 👋</h1>
              <p>Here's what's happening with your business today.</p>
            </div>

            <button
              className="primary-btn"
              onClick={() => {
                setFormError("");
                setShowModal(true);
              }}
            >
              <Plus size={18} /> Add customer
            </button>
          </div>

          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-top">
                <span>Total customers</span>
                <Users />
              </div>
              <h2>{customers.length}</h2>
              <small className="muted">Live MongoDB records</small>
            </div>

            <div className="stat-card">
              <div className="stat-top">
                <span>Gujarati</span>
                <Languages />
              </div>
              <h2>{languageCount("Gujarati")}</h2>
              <small className="muted">Preferred language</small>
            </div>

            <div className="stat-card">
              <div className="stat-top">
                <span>Hindi</span>
                <Languages />
              </div>
              <h2>{languageCount("Hindi")}</h2>
              <small className="muted">Preferred language</small>
            </div>

            <div className="stat-card">
              <div className="stat-top">
                <span>English</span>
                <Languages />
              </div>
              <h2>{languageCount("English")}</h2>
              <small className="success-text">Preferred language</small>
            </div>
          </div>

          <div className="content-grid">
            <section className="panel ledger-panel">
              <div className="panel-heading">
                <div>
                  <h3>Customer directory</h3>
                  <p>Live customer records from your database.</p>
                </div>

                <button
                  className="text-btn"
                  onClick={loadCustomers}
                >
                  Refresh <ArrowUpRight size={16} />
                </button>
              </div>

              <div className="table-controls">
                <div className="search-box">
                  <Search size={17} />
                  <input
                    placeholder="Search customers..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>CUSTOMER</th>
                      <th>PHONE</th>
                      <th>LANGUAGE</th>
                    </tr>
                  </thead>

                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan="3" className="empty">
                          <LoaderCircle size={18} />
                          Loading customers...
                        </td>
                      </tr>
                    ) : error ? (
                      <tr>
                        <td colSpan="3" className="empty">
                          {error}
                          <button onClick={loadCustomers}>Retry</button>
                        </td>
                      </tr>
                    ) : filteredCustomers.length > 0 ? (
                      filteredCustomers.map((customer) => (
                        <tr key={customer._id}>
                          <td>
                            <div className="customer-cell">
                              <div className="customer-avatar">
                                {customer.name.charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <strong>{customer.name}</strong>
                                <small>Customer</small>
                              </div>
                            </div>
                          </td>

                          <td>{customer.phone}</td>

                          <td>
                            <span className="status promised">
                              {customer.preferredLanguage}
                            </span>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="3" className="empty">
                          {search
                            ? "No matching customers found."
                            : "No customers yet. Add your first customer!"}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="panel ai-panel">
              <div className="ai-heading">
                <div className="ai-symbol">
                  <MessageSquare size={21} />
                </div>
                <span>AI ASSISTANT</span>
              </div>

              <h3>Conversations made simple.</h3>
              <p>
                Your AI assistant will understand payment messages
                in Gujarati, Hindi and English.
              </p>

              <div className="chat-example">
                <span>CUSTOMER MESSAGE</span>
                <p>"Bhai, Friday ko ₹2,000 de dunga."</p>

                <div className="ai-result">
                  <CheckCircle2 size={17} />
                  <div>
                    <strong>Payment promise detected</strong>
                    <small>Amount: ₹2,000 · Date: Friday</small>
                  </div>
                </div>
              </div>

              <button
                className="secondary-btn"
                onClick={() => setActive("AI Conversations")}
              >
                Explore AI conversations <ArrowUpRight size={16} />
              </button>
            </section>
          </div>

          <footer>
            © 2026 Vernacular AI Khata
            <span>Built for local businesses ❤️</span>
          </footer>
            </>
)}
        </section>
      </main>

      {showModal && (
        <div
          className="modal-overlay"
          onClick={() => !saving && setShowModal(false)}
        >
          <div
            className="customer-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <h2>Add new customer</h2>
                <p>Save a customer to your digital khata.</p>
              </div>

              <button
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

              {formError && (
                <p className="form-error">{formError}</p>
              )}

              <button
                type="submit"
                className="primary-btn modal-submit"
                disabled={saving}
              >
                {saving ? "Saving..." : "Save customer"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
