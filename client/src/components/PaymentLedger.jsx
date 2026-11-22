
import { useEffect, useState } from "react";
import {
  Wallet,
  RefreshCw,
  CheckCircle2,
  Clock,
  AlertCircle,
} from "lucide-react";

import {
  getCommitments,
  markPaymentReceived,
  updateCommitmentStatus,
} from "../services/api";


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

function PaymentLedger() {
  const [commitments, setCommitments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatingId, setUpdatingId] = useState(null);
  const [search, setSearch] = useState("");

  const loadCommitments = async () => {
    try {
      setError("");
      setLoading(true);

      const data = await getCommitments();
      setCommitments(data);
    } catch (err) {
      setError("Unable to load payment records.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCommitments();
  }, []);

  const handleMarkPaid = async (id) => {
    try {
      setUpdatingId(id);
      await markPaymentReceived(id);
      await loadCommitments();
    } catch (err) {
      setError(err.message || "Payment update failed.");
    } finally {
      setUpdatingId(null);
    }
  };

  const handleStatusChange = async (id, status) => {
    try {
      setUpdatingId(id);

      await updateCommitmentStatus(id, status);

      await loadCommitments();
    } catch (err) {
      setError(err.message || "Status update failed.");
    } finally {
      setUpdatingId(null);
    }
  };

  const paidRecords = commitments.filter(
    (item) => item.paymentStatus === "Paid"
  );

  const unpaidRecords = commitments.filter(
    (item) => item.paymentStatus !== "Paid"
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
    const name = item.customer?.name || "";
    return name.toLowerCase().includes(search.toLowerCase());
  });

  return (
    <>
      <div className="welcome-row">
        <div>
          <div className="eyebrow">PAYMENT MANAGEMENT</div>
          <h1>Payment Ledger</h1>
          <p>Track customer promises and actual payments.</p>
        </div>

        <button className="primary-btn" onClick={loadCommitments}>
          <RefreshCw size={17} /> Refresh records
        </button>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-top">
            <span>Total commitments</span>
            <Wallet />
          </div>
          <h2>{commitments.length}</h2>
          <small className="muted">All payment records</small>
        </div>

        <div className="stat-card">
          <div className="stat-top">
            <span>Outstanding</span>
            <Clock />
          </div>
          <h2>{money(unpaidAmount)}</h2>
          <small className="muted">
            {unpaidRecords.length} unpaid records
          </small>
        </div>

        <div className="stat-card">
          <div className="stat-top">
            <span>Payment received</span>
            <CheckCircle2 />
          </div>
          <h2>{money(paidAmount)}</h2>
          <small className="success-text">
            {paidRecords.length} paid records
          </small>
        </div>

        <div className="stat-card">
          <div className="stat-top">
            <span>Total committed</span>
            <Wallet />
          </div>
          <h2>{money(paidAmount + unpaidAmount)}</h2>
          <small className="muted">Total recorded amount</small>
        </div>
      </div>

      <section className="panel ledger-panel">
        <div className="panel-heading">
          <div>
            <h3>Customer payment records</h3>
            <p>Live data from your MongoDB database.</p>
          </div>
        </div>

        <div className="table-controls">
          <input
            placeholder="Search customer..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {error && (
          <p style={{ color: "#dc2626", padding: "12px" }}>
            <AlertCircle size={16} /> {error}
          </p>
        )}

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
              {loading ? (
                <tr>
                  <td colSpan="6" className="empty">
                    Loading payment records...
                  </td>
                </tr>
              ) : filteredCommitments.length > 0 ? (
                filteredCommitments.map((item) => {
                  const isPaid = item.paymentStatus === "Paid";
                  const isUpdating = updatingId === item._id;

                  return (
                    <tr key={item._id}>
                      <td>
                        <strong>
                          {item.customer?.name || "Unknown customer"}
                        </strong>
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
                        <span
                          style={{
                            display: "inline-block",
                            padding: "5px 10px",
                            borderRadius: "20px",
                            fontSize: "12px",
                            fontWeight: 600,
                            color: isPaid ? "#15803d" : "#b45309",
                            background: isPaid ? "#dcfce7" : "#fef3c7",
                          }}
                        >
                          {isPaid ? "Paid" : "Unpaid"}
                        </span>
                      </td>

                      <td>
                        <button
                          className="text-btn"
                          disabled={isPaid || isUpdating}
                          onClick={() => handleMarkPaid(item._id)}
                        >
                          {isPaid
                            ? "Payment received"
                            : isUpdating
                              ? "Updating..."
                              : "Mark as Paid"}
                        </button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan="6" className="empty">
                    No payment records found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

export default PaymentLedger;
