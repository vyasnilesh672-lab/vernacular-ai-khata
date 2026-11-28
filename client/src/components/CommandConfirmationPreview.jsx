import { AnimatePresence } from "framer-motion";
import { CheckCircle2, XCircle, AlertTriangle, Languages } from "lucide-react";
import {
  ArcMotionItem,
  FocusStageCard,
  MotionButton,
  StatusPill,
} from "../motion/motionPrimitives";

const CATEGORY_LABELS = {
  payment_promise: "Payment Promise",
  payment_received: "Payment Received",
  partial_payment: "Partial Payment",
  inventory_purchase: "Inventory Purchase",
  inventory_deduction: "Inventory Deduction",
  product_transformation: "Product Transformation",
  inventory_sale: "Inventory Sale",
  unclear: "Unclear Command",
};

const formatRupees = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? `₹${num.toLocaleString("en-IN")}` : "Not identified";
};

function CommandConfirmationPreview({
  session,
  confirmationToken,
  saving,
  onConfirm,
  onReject,
}) {
  const shouldShow = Boolean(session && !session.isReadOnly);

  const {
    commandCategory,
    status,
    draft = {},
    validationErrors = [],
    proposedChanges = [],
    clarificationPrompt,
  } = session || {};

  const isAwaitingConfirmation =
    status === "awaiting_confirmation" && Boolean(confirmationToken);
  const isExecuted = status === "executed";
  const canInteract =
    status === "awaiting_confirmation" || status === "awaiting_clarification";

  const outputs = Array.isArray(draft.outputs) ? draft.outputs : [];
  const finishedOutputs = outputs.filter((o) => o.role !== "by_product");
  const byProducts = outputs.filter((o) => o.role === "by_product");

  const saleTotal =
    Number.isFinite(Number(draft.quantity)) &&
    Number.isFinite(Number(draft.unitPrice))
      ? Number(draft.quantity) * Number(draft.unitPrice)
      : null;

  const renderCategoryFields = () => {
    if (
      commandCategory === "payment_promise" ||
      commandCategory === "payment_received"
    ) {
      return (
        <>
          <div>
            <small>Customer</small>
            <h3>{draft.customerName || draft.mentionedCustomer || "Not identified"}</h3>
          </div>
          <div>
            <small>Amount</small>
            <h3>{draft.amount ? formatRupees(draft.amount) : "Not identified"}</h3>
          </div>
          <div>
            <small>
              {commandCategory === "payment_received"
                ? "Received date"
                : "Promised date"}
            </small>
            <h3>{draft.promisedDate || "Needs clarification"}</h3>
          </div>
        </>
      );
    }

    if (commandCategory === "partial_payment") {
      return (
        <>
          <div>
            <small>Customer</small>
            <h3>{draft.customerName || draft.mentionedCustomer || "Not identified"}</h3>
          </div>
          <div>
            <small>Amount received</small>
            <h3>{draft.amount ? formatRupees(draft.amount) : "Not identified"}</h3>
          </div>
          <div>
            <small>Revised date (optional)</small>
            <h3>{draft.promisedDate || "Keep existing date"}</h3>
          </div>
        </>
      );
    }

    if (commandCategory === "inventory_purchase") {
      return (
        <>
          <div>
            <small>Product</small>
            <h3>{draft.productName || draft.mentionedProduct || "Not identified"}</h3>
          </div>
          <div>
            <small>Quantity</small>
            <h3>
              {draft.quantity ? `${draft.quantity} ${draft.unit || ""}` : "Not identified"}
            </h3>
          </div>
          {draft.unitCost !== null && draft.unitCost !== undefined && (
            <div>
              <small>Unit cost</small>
              <h3>{formatRupees(draft.unitCost)}</h3>
            </div>
          )}
        </>
      );
    }

    if (commandCategory === "inventory_deduction") {
      return (
        <>
          <div>
            <small>Product</small>
            <h3>{draft.productName || draft.mentionedProduct || "Not identified"}</h3>
          </div>
          <div>
            <small>Quantity to deduct</small>
            <h3>
              {draft.quantity ? `${draft.quantity} ${draft.unit || ""}` : "Not identified"}
            </h3>
          </div>
        </>
      );
    }

    if (commandCategory === "product_transformation") {
      return (
        <>
          <div>
            <small>Input raw material</small>
            <h3>
              {draft.quantity
                ? `${draft.quantity} ${draft.unit || ""} ${draft.productName || draft.mentionedProduct || ""}`
                : draft.productName || "Not identified"}
            </h3>
          </div>
          <div>
            <small>Outputs</small>
            <h3>
              {finishedOutputs.length > 0
                ? finishedOutputs
                    .map((o) => `${o.quantity} ${o.unit} ${o.productName}`)
                    .join(", ")
                : "Not specified"}
            </h3>
          </div>
          <div>
            <small>By-products</small>
            <h3>
              {byProducts.length > 0
                ? byProducts
                    .map((o) => `${o.quantity} ${o.unit} ${o.productName}`)
                    .join(", ")
                : "None"}
            </h3>
          </div>
          <div>
            <small>Processing loss</small>
            <h3>
              {draft.processingLoss !== null && draft.processingLoss !== undefined
                ? `${draft.processingLoss} ${draft.unit || ""}`
                : "0"}
            </h3>
          </div>
        </>
      );
    }

    if (commandCategory === "inventory_sale") {
      return (
        <>
          <div>
            <small>Customer</small>
            <h3>{draft.customerName || draft.mentionedCustomer || "Walk-in / Unspecified"}</h3>
          </div>
          <div>
            <small>Product</small>
            <h3>{draft.productName || draft.mentionedProduct || "Not identified"}</h3>
          </div>
          <div>
            <small>Quantity</small>
            <h3>
              {draft.quantity ? `${draft.quantity} ${draft.unit || ""}` : "Not identified"}
            </h3>
          </div>
          <div>
            <small>Unit price</small>
            <h3>
              {draft.unitPrice !== null && draft.unitPrice !== undefined
                ? `${formatRupees(draft.unitPrice)}/${draft.unit || "unit"}`
                : "Default / missing"}
            </h3>
          </div>
          <div>
            <small>Total</small>
            <h3>{saleTotal !== null ? formatRupees(saleTotal) : "Not calculated"}</h3>
          </div>
        </>
      );
    }

    return null;
  };

  return (
    <AnimatePresence mode="wait">
      {shouldShow && (
        <FocusStageCard
          key={`${session.sessionId}-${status}-${draft.promisedDate || ""}-${draft.amount || ""}`}
          focused={isAwaitingConfirmation || isExecuted}
          style={{
            padding: "24px",
            marginBottom: "22px",
            borderStyle: isExecuted ? "solid" : "dashed",
            borderColor: isExecuted ? "var(--teal)" : "var(--coral)",
          }}
        >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "10px",
          }}
        >
          <div>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "8px" }}>
              <span className="status promised">
                {CATEGORY_LABELS[commandCategory] || commandCategory}
              </span>
              <StatusPill
                statusKey={status}
                className={isExecuted ? "status paid" : "status pending"}
              >
                {isExecuted
                  ? "Confirmed & Recorded in Khata"
                  : status === "rejected"
                    ? "Rejected — No Changes Saved"
                    : "AI Suggestion — Not Saved Yet"}
              </StatusPill>
            </div>
            <h3>{isExecuted ? "Recorded Transaction" : "Confirmation Preview"}</h3>
          </div>

          <strong
            style={{
              color: (draft.confidence || 0) >= 0.75 ? "var(--teal)" : "#B46914",
              fontSize: "13px",
            }}
          >
            {Math.round((draft.confidence || 0) * 100)}% confidence
          </strong>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(175px, 1fr))",
            gap: "16px",
            margin: "20px 0",
          }}
        >
          {renderCategoryFields()}

          {draft.language && (
            <div>
              <small>Language</small>
              <h3>
                <Languages size={15} /> {draft.language}
              </h3>
            </div>
          )}
        </div>

        {proposedChanges.length > 0 && (
          <ArcMotionItem
            index={0}
            className="detail-drawer"
            style={{
              background: "var(--teal-soft)",
              borderColor: "var(--border)",
              marginBottom: "14px",
              fontSize: "13px",
              color: "var(--teal)",
            }}
          >
            <strong style={{ display: "block", marginBottom: "4px" }}>
              {isExecuted ? "Applied changes:" : "Proposed changes (not saved yet):"}
            </strong>
            {proposedChanges.map((change, idx) => (
              <div key={idx}>• {change}</div>
            ))}
          </ArcMotionItem>
        )}

        {(validationErrors.length > 0 || clarificationPrompt) && (
          <div
            style={{
              background: "#FFF8E8",
              border: "1px solid #F4DFB4",
              padding: "13px 15px",
              borderRadius: "9px",
              marginBottom: "16px",
              fontSize: "13px",
              color: "#8A5A14",
              display: "flex",
              gap: "8px",
              alignItems: "flex-start",
            }}
          >
            <AlertTriangle size={17} style={{ flexShrink: 0, marginTop: "2px" }} />
            <div>{clarificationPrompt || validationErrors.join(" ")}</div>
          </div>
        )}

        {isAwaitingConfirmation && (
          <div
            style={{
              background: "#FFF8E8",
              padding: "12px 14px",
              borderRadius: "9px",
              marginBottom: "16px",
              fontSize: "13px",
            }}
          >
            Review the proposed changes above. Nothing is saved until you confirm.
          </div>
        )}

        {canInteract && (
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <MotionButton
              className="primary-btn"
              onClick={onConfirm}
              disabled={!isAwaitingConfirmation || saving}
              anticipate
            >
              <CheckCircle2 size={16} />
              {saving ? "Confirming..." : "Confirm & Save"}
            </MotionButton>

            <MotionButton
              className="secondary-btn"
              onClick={onReject}
              disabled={saving}
            >
              <XCircle size={16} />
              Reject / Cancel
            </MotionButton>
          </div>
        )}
        </FocusStageCard>
      )}
    </AnimatePresence>
  );
}

export default CommandConfirmationPreview;
