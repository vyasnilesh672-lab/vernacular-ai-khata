import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Package,
  RefreshCw,
  Plus,
  TrendingUp,
  Layers,
  ArrowRight,
} from "lucide-react";
import {
  getInventoryProducts,
  createInventoryProduct,
  recordInventoryPurchase,
  getInventoryTransformations,
  getInventoryPnl,
} from "../services/api";
import { ARC_EASE, TIMINGS } from "../motion/motionTokens";
import {
  MotionButton,
  StaggerGrid,
  StaggerCard,
  ArcMotionItem,
  FollowThroughDrawer,
  AnimatedProgressBar,
  AnimatedValue,
  StatusPill,
  SuccessFeedbackBanner,
  ErrorFeedbackBanner,
  SkeletonStatsGrid,
  SkeletonList,
  EmptyStateBox,
} from "../motion/motionPrimitives";

const money = (amount) =>
  amount === null || amount === undefined
    ? "N/A (missing cost)"
    : new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 2,
      }).format(amount);

const formatDate = (dateValue) => {
  if (!dateValue) return "N/A";
  return new Date(dateValue).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
};

function InventoryView() {
  const [products, setProducts] = useState([]);
  const [transformations, setTransformations] = useState([]);
  const [pnl, setPnl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    category: "Spices",
    productRole: "raw_material",
    currentStock: "0",
    unit: "kg",
    purchaseCost: "",
    sellingPrice: "",
    minimumStockThreshold: "0",
  });
  const [purchaseTarget, setPurchaseTarget] = useState(null);
  const [purchaseQty, setPurchaseQty] = useState("");
  const [purchaseCost, setPurchaseCost] = useState("");

  const loadInventory = async () => {
    try {
      setLoading(true);
      setError("");
      const [prods, txs, pnlData] = await Promise.all([
        getInventoryProducts(),
        getInventoryTransformations(),
        getInventoryPnl(),
      ]);
      setProducts(prods);
      setTransformations(txs);
      setPnl(pnlData);
    } catch (err) {
      setError(err.message || "Unable to load inventory data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    const init = async () => {
      try {
        const [prods, txs, pnlData] = await Promise.all([
          getInventoryProducts(),
          getInventoryTransformations(),
          getInventoryPnl(),
        ]);
        if (active) {
          setProducts(prods);
          setTransformations(txs);
          setPnl(pnlData);
          setError("");
        }
      } catch (err) {
        if (active) {
          setError(err.message || "Unable to load inventory data.");
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    init();
    return () => {
      active = false;
    };
  }, []);

  const handleAddProduct = async (e) => {
    e.preventDefault();
    try {
      setSaving(true);
      setError("");
      setSuccessMsg("");
      const created = await createInventoryProduct({
        ...form,
        currentStock: Number(form.currentStock || 0),
        purchaseCost: form.purchaseCost === "" ? null : Number(form.purchaseCost),
        sellingPrice: form.sellingPrice === "" ? null : Number(form.sellingPrice),
        minimumStockThreshold: Number(form.minimumStockThreshold || 0),
      });
      setForm({
        name: "",
        category: "Spices",
        productRole: "raw_material",
        currentStock: "0",
        unit: "kg",
        purchaseCost: "",
        sellingPrice: "",
        minimumStockThreshold: "0",
      });
      setShowAdd(false);
      await loadInventory();
      setSuccessMsg(`Product "${created.name}" created.`);
    } catch (err) {
      setError(err.message || "Failed to add product.");
    } finally {
      setSaving(false);
    }
  };

  const handlePurchase = async (e) => {
    e.preventDefault();
    if (!purchaseTarget) return;
    try {
      setSaving(true);
      setError("");
      setSuccessMsg("");
      const res = await recordInventoryPurchase(purchaseTarget._id, {
        quantity: Number(purchaseQty),
        unit: purchaseTarget.unit,
        unitCost: purchaseCost === "" ? undefined : Number(purchaseCost),
      });
      const updatedName = purchaseTarget.name;
      setPurchaseTarget(null);
      setPurchaseQty("");
      setPurchaseCost("");
      await loadInventory();
      setSuccessMsg(
        `Added stock to "${updatedName}". New stock: ${res.product.currentStock} ${res.product.unit}.`
      );
    } catch (err) {
      setError(err.message || "Stock purchase failed.");
    } finally {
      setSaving(false);
    }
  };

  const lowStockCount = products.filter((p) => p.isLowStock).length;
  const maxStock = Math.max(...products.map((p) => p.currentStock || 0), 1);

  return (
    <>
      <div className="welcome-row">
        <div>
          <div className="eyebrow">INVENTORY & TRANSFORMATION ENGINE</div>
          <h1>Inventory & P&L</h1>
          <p>Live stock levels, raw-to-finished transformations, and realized vs estimated profit.</p>
        </div>

        <div className="header-actions">
          <MotionButton
            className="secondary-btn"
            onClick={loadInventory}
            disabled={loading}
          >
            <RefreshCw size={16} className={loading ? "icon-spin" : ""} />{" "}
            {loading ? "Refreshing" : "Refresh"}
          </MotionButton>
          <MotionButton
            className="primary-btn"
            anticipate
            onClick={() => setShowAdd(!showAdd)}
          >
            <Plus size={17} /> {showAdd ? "Close form" : "Add product"}
          </MotionButton>
        </div>
      </div>

      <ErrorFeedbackBanner
        message={error}
        onRetry={loadInventory}
        onDismiss={() => setError("")}
      />

      <SuccessFeedbackBanner
        message={successMsg}
        onDismiss={() => setSuccessMsg("")}
      />

      {loading ? (
        <SkeletonStatsGrid count={4} />
      ) : (
        <StaggerGrid>
          <StaggerCard>
            <div className="stat-top">
              <span>Products</span>
              <Package />
            </div>
            <h2>
              <AnimatedValue value={products.length}>{products.length}</AnimatedValue>
            </h2>
            <small className={lowStockCount > 0 ? "danger-text" : "muted"}>
              {lowStockCount} low stock alert(s)
            </small>
          </StaggerCard>

          <StaggerCard>
            <div className="stat-top">
              <span>Transformations</span>
              <Layers />
            </div>
            <h2>
              <AnimatedValue value={transformations.length}>
                {transformations.length}
              </AnimatedValue>
            </h2>
            <small className="muted">Batch conversions logged</small>
          </StaggerCard>

          <StaggerCard>
            <div className="stat-top">
              <span>Realized sales revenue</span>
              <TrendingUp />
            </div>
            <h2>
              <AnimatedValue value={pnl?.actualRealized?.totalRevenue || 0}>
                {money(pnl?.actualRealized?.totalRevenue || 0)}
              </AnimatedValue>
            </h2>
            <small className="muted">
              {pnl?.actualRealized?.totalSalesCount || 0} sale(s)
            </small>
          </StaggerCard>

          <StaggerCard>
            <div className="stat-top">
              <span>Actual realized profit</span>
              <TrendingUp />
            </div>
            <h2>
              {pnl?.actualRealized?.exactProfitAvailable ? (
                <AnimatedValue value={pnl.actualRealized.actualProfit}>
                  {money(pnl.actualRealized.actualProfit)}
                </AnimatedValue>
              ) : (
                "Incomplete cost"
              )}
            </h2>
            <small className="muted">
              Est. transformation value:{" "}
              {money(pnl?.estimatedFromTransformations?.estimatedOutputPotentialRevenue || 0)}
            </small>
          </StaggerCard>
        </StaggerGrid>
      )}

      <FollowThroughDrawer isOpen={showAdd}>
        <div className="panel" style={{ marginBottom: "18px" }}>
          <div className="panel-heading">
            <h3>Add new inventory product</h3>
          </div>
          <form
            onSubmit={handleAddProduct}
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
              gap: "12px",
            }}
          >
            <input
              placeholder="Product name (e.g. Raw Garlic)"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              style={{ padding: "10px", border: "1px solid var(--border)", borderRadius: "8px", background: "#fff" }}
            />
            <input
              placeholder="Category (e.g. Spices)"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              required
              style={{ padding: "10px", border: "1px solid var(--border)", borderRadius: "8px", background: "#fff" }}
            />
            <select
              value={form.productRole}
              onChange={(e) => setForm({ ...form, productRole: e.target.value })}
              style={{ padding: "10px", border: "1px solid var(--border)", borderRadius: "8px", background: "#fff" }}
            >
              <option value="raw_material">Raw Material</option>
              <option value="finished_good">Finished Good</option>
              <option value="by_product">By-Product</option>
              <option value="general">General</option>
            </select>
            <select
              value={form.unit}
              onChange={(e) => setForm({ ...form, unit: e.target.value })}
              style={{ padding: "10px", border: "1px solid var(--border)", borderRadius: "8px", background: "#fff" }}
            >
              <option value="kg">kg</option>
              <option value="gram">gram</option>
              <option value="litre">litre</option>
              <option value="ml">ml</option>
              <option value="piece">piece</option>
              <option value="packet">packet</option>
              <option value="peti">peti</option>
              <option value="katta">katta</option>
              <option value="nag">nag</option>
            </select>
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="Initial stock"
              value={form.currentStock}
              onChange={(e) => setForm({ ...form, currentStock: e.target.value })}
              style={{ padding: "10px", border: "1px solid var(--border)", borderRadius: "8px", background: "#fff" }}
            />
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="Purchase cost (₹)"
              value={form.purchaseCost}
              onChange={(e) => setForm({ ...form, purchaseCost: e.target.value })}
              style={{ padding: "10px", border: "1px solid var(--border)", borderRadius: "8px", background: "#fff" }}
            />
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="Default selling price (₹)"
              value={form.sellingPrice}
              onChange={(e) => setForm({ ...form, sellingPrice: e.target.value })}
              style={{ padding: "10px", border: "1px solid var(--border)", borderRadius: "8px", background: "#fff" }}
            />
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="Min threshold"
              value={form.minimumStockThreshold}
              onChange={(e) => setForm({ ...form, minimumStockThreshold: e.target.value })}
              style={{ padding: "10px", border: "1px solid var(--border)", borderRadius: "8px", background: "#fff" }}
            />
            <MotionButton type="submit" className="primary-btn" anticipate disabled={saving}>
              {saving ? "Saving..." : "Save product"}
            </MotionButton>
          </form>
        </div>
      </FollowThroughDrawer>

      <FollowThroughDrawer isOpen={Boolean(purchaseTarget)}>
        {purchaseTarget && (
          <div className="panel" style={{ marginBottom: "18px" }}>
            <div className="panel-heading">
              <h3>
                Record stock purchase: {purchaseTarget.name} ({purchaseTarget.unit})
              </h3>
              <MotionButton
                className="text-btn"
                onClick={() => setPurchaseTarget(null)}
              >
                Cancel
              </MotionButton>
            </div>
            <form
              onSubmit={handlePurchase}
              style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}
            >
              <input
                type="number"
                min="0.01"
                step="0.01"
                placeholder={`Quantity (${purchaseTarget.unit})`}
                value={purchaseQty}
                onChange={(e) => setPurchaseQty(e.target.value)}
                required
                style={{ padding: "10px", border: "1px solid var(--border)", borderRadius: "8px", background: "#fff" }}
              />
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="Unit cost (₹ optional)"
                value={purchaseCost}
                onChange={(e) => setPurchaseCost(e.target.value)}
                style={{ padding: "10px", border: "1px solid var(--border)", borderRadius: "8px", background: "#fff" }}
              />
              <MotionButton type="submit" className="primary-btn" anticipate disabled={saving}>
                {saving ? "Saving..." : "Confirm purchase"}
              </MotionButton>
            </form>
          </div>
        )}
      </FollowThroughDrawer>

      <div className="dashboard-grid-2">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h3>Product stock directory</h3>
              <p>Live stock quantities, thresholds, and pricing.</p>
            </div>
          </div>

          {loading ? (
            <SkeletonList rows={3} />
          ) : products.length > 0 ? (
            <div className="item-list">
              {products.map((p, idx) => (
                <ArcMotionItem
                  key={p._id}
                  index={idx}
                  style={{ display: "block" }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: "12px",
                      marginBottom: "8px",
                    }}
                  >
                    <div>
                      <strong>{p.name}</strong>
                      <small>
                        {p.category} · {p.productRole.replace(/_/g, " ")} · Cost:{" "}
                        {p.purchaseCost !== null ? money(p.purchaseCost) : "Unset"} · Sell:{" "}
                        {p.sellingPrice !== null ? money(p.sellingPrice) : "Unset"}
                      </small>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <StatusPill
                        statusKey={p.isLowStock ? "low-stock" : "healthy"}
                        className={p.isLowStock ? "status overdue" : "status paid"}
                      >
                        {p.isLowStock ? "Low stock" : "Healthy"}
                      </StatusPill>
                      <MotionButton
                        className="text-btn"
                        style={{ display: "block", marginLeft: "auto", marginTop: "4px" }}
                        onClick={() => setPurchaseTarget(p)}
                      >
                        + Add stock
                      </MotionButton>
                    </div>
                  </div>
                  <div className="bar-label">
                    <span className="muted">Current stock</span>
                    <strong>
                      <AnimatedValue value={p.currentStock}>
                        {p.currentStock} {p.unit}
                      </AnimatedValue>
                    </strong>
                  </div>
                  <AnimatedProgressBar
                    percent={
                      p.currentStock > 0
                        ? Math.max(5, Math.round((p.currentStock / maxStock) * 100))
                        : 0
                    }
                    variant={p.isLowStock ? "coral" : "teal"}
                  />
                </ArcMotionItem>
              ))}
            </div>
          ) : (
            <EmptyStateBox message="No inventory products yet." />
          )}
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <h3>Product transformations</h3>
              <p>Visual input → output, by-product, yield, and loss breakdown.</p>
            </div>
          </div>

          {loading ? (
            <SkeletonList rows={3} />
          ) : transformations.length > 0 ? (
            <div className="item-list">
              {transformations.slice(0, 6).map((tx, idx) => (
                <ArcMotionItem
                  key={tx._id}
                  index={idx}
                  style={{ display: "block" }}
                >
                  <div className="transform-flow" style={{ marginBottom: "10px" }}>
                    <div className="transform-node">
                      <small>INPUT</small>
                      <strong>
                        {tx.input?.quantity} {tx.input?.unit} {tx.input?.productName}
                      </strong>
                      <small>{formatDate(tx.createdAt)}</small>
                    </div>

                    <motion.div
                      initial={{ x: -8, y: 4, opacity: 0.4 }}
                      animate={{ x: 0, y: 0, opacity: 1 }}
                      transition={{
                        duration: TIMINGS.card,
                        delay: Math.min(idx * 0.05 + 0.08, 0.35),
                        ease: ARC_EASE,
                      }}
                      style={{ display: "grid", placeItems: "center" }}
                    >
                      <ArrowRight size={18} color="var(--coral)" />
                    </motion.div>

                    <div className="transform-node">
                      <small>OUTPUTS & LOSS</small>
                      {tx.outputs.map((o, i) => (
                        <strong key={i} style={{ fontSize: "12px" }}>
                          {o.quantity} {o.unit} {o.productName} ({o.role.replace(/_/g, " ")})
                        </strong>
                      ))}
                      <small>
                        Loss: {tx.processingLoss} {tx.lossUnit} · Cost:{" "}
                        {tx.totalInputCost !== null ? money(tx.totalInputCost) : "Unset"}
                      </small>
                    </div>
                  </div>

                  <div className="bar-label">
                    <span>Yield efficiency</span>
                    <strong>{tx.yieldPercentage}%</strong>
                  </div>
                  <AnimatedProgressBar percent={tx.yieldPercentage} variant="teal" />
                </ArcMotionItem>
              ))}
            </div>
          ) : (
            <EmptyStateBox message='No transformations recorded yet. Try "10 kilo raw garlic peel karo" in AI Conversations.' />
          )}
        </section>
      </div>
    </>
  );
}

export default InventoryView;
