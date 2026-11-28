import { useState } from "react";
import { motion } from "framer-motion";
import { Users, Languages, Plus, Search, RefreshCw } from "lucide-react";
import { ARC_EASE, TIMINGS } from "../motion/motionTokens";
import {
  MotionButton,
  StaggerGrid,
  StaggerCard,
  StatusPill,
  AnimatedValue,
  ErrorFeedbackBanner,
  SkeletonStatsGrid,
  SkeletonList,
  EmptyStateBox,
} from "../motion/motionPrimitives";

function CustomersDirectoryView({
  customers,
  loading,
  error,
  onReload,
  onOpenAddModal,
}) {
  const [search, setSearch] = useState("");

  const filteredCustomers = customers.filter((customer) => {
    const query = search.toLowerCase();
    return (
      customer.name.toLowerCase().includes(query) ||
      customer.phone.includes(query)
    );
  });

  const languageCount = (language) =>
    customers.filter((customer) => customer.preferredLanguage === language).length;

  return (
    <>
      <div className="welcome-row">
        <div>
          <div className="eyebrow">CUSTOMER DIRECTORY</div>
          <h1>Customers</h1>
          <p>Manage customer contacts and preferred vernacular languages.</p>
        </div>

        <MotionButton className="primary-btn" anticipate onClick={onOpenAddModal}>
          <Plus size={18} /> Add customer
        </MotionButton>
      </div>

      {loading ? (
        <SkeletonStatsGrid count={4} />
      ) : (
        <StaggerGrid>
          <StaggerCard>
            <div className="stat-top">
              <span>Total customers</span>
              <Users />
            </div>
            <h2>
              <AnimatedValue value={customers.length}>
                {customers.length}
              </AnimatedValue>
            </h2>
            <small className="muted">Live MongoDB records</small>
          </StaggerCard>

          <StaggerCard>
            <div className="stat-top">
              <span>Gujarati</span>
              <Languages />
            </div>
            <h2>
              <AnimatedValue value={languageCount("Gujarati")}>
                {languageCount("Gujarati")}
              </AnimatedValue>
            </h2>
            <small className="muted">Preferred language</small>
          </StaggerCard>

          <StaggerCard>
            <div className="stat-top">
              <span>Hindi</span>
              <Languages />
            </div>
            <h2>
              <AnimatedValue value={languageCount("Hindi")}>
                {languageCount("Hindi")}
              </AnimatedValue>
            </h2>
            <small className="muted">Preferred language</small>
          </StaggerCard>

          <StaggerCard>
            <div className="stat-top">
              <span>English</span>
              <Languages />
            </div>
            <h2>
              <AnimatedValue value={languageCount("English")}>
                {languageCount("English")}
              </AnimatedValue>
            </h2>
            <small className="success-text">Preferred language</small>
          </StaggerCard>
        </StaggerGrid>
      )}

      <section className="panel ledger-panel">
        <div className="panel-heading">
          <div>
            <h3>Customer directory</h3>
            <p>Live customer records from your database.</p>
          </div>

          <MotionButton
            className="text-btn"
            onClick={onReload}
            disabled={loading}
          >
            <RefreshCw size={15} className={loading ? "icon-spin" : ""} /> Refresh
          </MotionButton>
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

        {loading ? (
          <SkeletonList rows={3} />
        ) : error ? (
          <ErrorFeedbackBanner message={error} onRetry={onReload} />
        ) : (
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
                {filteredCustomers.length > 0 ? (
                  filteredCustomers.map((customer, idx) => (
                    <motion.tr
                      key={customer._id}
                      initial={{ opacity: 0, x: -6, y: 4 }}
                      animate={{ opacity: 1, x: 0, y: 0 }}
                      transition={{
                        duration: TIMINGS.micro,
                        delay: Math.min(idx * 0.02, 0.16),
                        ease: ARC_EASE,
                      }}
                    >
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
                        <StatusPill
                          statusKey={customer.preferredLanguage}
                          className="status promised"
                        >
                          {customer.preferredLanguage}
                        </StatusPill>
                      </td>
                    </motion.tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="3">
                      <EmptyStateBox
                        message={
                          search
                            ? "No matching customers found."
                            : "No customers yet. Add your first customer!"
                        }
                      />
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

export default CustomersDirectoryView;
