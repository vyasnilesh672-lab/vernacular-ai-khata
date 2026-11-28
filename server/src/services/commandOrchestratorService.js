import crypto from "node:crypto";
import mongoose from "mongoose";
import CommandSession from "../models/CommandSession.js";
import Customer from "../models/Customer.js";
import Commitment from "../models/Commitment.js";
import Product, { ALLOWED_INVENTORY_UNITS } from "../models/Product.js";
import TransformationRecipe from "../models/TransformationRecipe.js";
import CustomerPrice from "../models/CustomerPrice.js";
import {
  interpretUnifiedCommand,
  translateCustomerInsights,
} from "./geminiService.js";
import {
  CommitmentError,
  createConfirmedCommitment,
  getTodayIST,
  isValidISODate,
  recordPartialPaymentOnCommitment,
} from "./commitmentService.js";
import {
  InventoryError,
  convertQuantity,
  executeTransformation,
  recordDeduction,
  recordPurchase,
  recordSale,
} from "./inventoryService.js";
import {
  CustomerIntelligenceError,
  buildCustomerIntelligence,
} from "./customerIntelligenceService.js";

export class CommandOrchestratorError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const SESSION_TTL_MS = 15 * 60 * 1000;
const UNIT_SET = new Set(ALLOWED_INVENTORY_UNITS);

const READ_ONLY_CATEGORIES = new Set([
  "customer_info_query",
  "customer_outstanding_query",
  "customer_risk_query",
]);

const MUTATION_CATEGORIES = new Set([
  "payment_received",
  "payment_promise",
  "partial_payment",
  "inventory_purchase",
  "inventory_deduction",
  "product_transformation",
  "inventory_sale",
]);

const CONFIRM_PATTERN =
  /^(confirm|confirmed|haan\s*confirm(\s*karo)?|ha\s*confirm|yes(\s*confirm)?|ok\s*save(\s*karo)?|save\s*karo|pakka\s*save)\.?$/i;
const REJECT_PATTERN =
  /^(cancel|reject|no|nahi|mat\s*karo|rehne\s*do|abort)\.?$/i;

const hashToken = (token) =>
  crypto.createHash("sha256").update(token, "utf8").digest("hex");

const verifyTokenHash = (providedToken, storedHash) => {
  if (
    typeof providedToken !== "string" ||
    !providedToken.trim() ||
    typeof storedHash !== "string"
  ) {
    return false;
  }
  const providedHash = hashToken(providedToken.trim());
  const a = Buffer.from(providedHash, "utf8");
  const b = Buffer.from(storedHash, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const issueConfirmationToken = () => {
  const token = crypto.randomBytes(32).toString("hex");
  return {
    token,
    hash: hashToken(token),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  };
};

const mergeDraft = (existingDraft = {}, interpreted = {}, rawMessage, overrides = {}) => {
  const merged = {
    customerId: interpreted.customerId ?? existingDraft.customerId ?? null,
    customerName: interpreted.customerName ?? existingDraft.customerName ?? null,
    mentionedCustomer:
      interpreted.mentionedCustomer ?? existingDraft.mentionedCustomer ?? null,
    amount: interpreted.amount ?? existingDraft.amount ?? null,
    promisedDate:
      interpreted.promisedDate !== null
        ? interpreted.promisedDate
        : interpreted.dateAmbiguous
          ? null
          : existingDraft.promisedDate ?? null,
    dateAmbiguous: Boolean(
      interpreted.dateAmbiguous && interpreted.promisedDate === null
    ),
    productId: interpreted.productId ?? existingDraft.productId ?? null,
    productName: interpreted.productName ?? existingDraft.productName ?? null,
    mentionedProduct:
      interpreted.mentionedProduct ?? existingDraft.mentionedProduct ?? null,
    quantity: interpreted.quantity ?? existingDraft.quantity ?? null,
    unit: interpreted.unit ?? existingDraft.unit ?? null,
    unitPrice: interpreted.unitPrice ?? existingDraft.unitPrice ?? null,
    unitCost: interpreted.unitCost ?? existingDraft.unitCost ?? null,
    recipeId: interpreted.recipeId ?? existingDraft.recipeId ?? null,
    outputs:
      Array.isArray(interpreted.outputs) && interpreted.outputs.length > 0
        ? interpreted.outputs
        : existingDraft.outputs || [],
    processingLoss:
      interpreted.processingLoss ?? existingDraft.processingLoss ?? null,
    processingCost:
      interpreted.processingCost ?? existingDraft.processingCost ?? null,
    commitmentId: existingDraft.commitmentId ?? null,
    language: interpreted.language ?? existingDraft.language ?? null,
    notes: interpreted.notes ?? existingDraft.notes ?? null,
    confidence: interpreted.confidence ?? existingDraft.confidence ?? 0,
    originalMessage: existingDraft.originalMessage
      ? `${existingDraft.originalMessage} | ${rawMessage}`
      : rawMessage,
  };

  if (overrides && typeof overrides === "object") {
    for (const [k, v] of Object.entries(overrides)) {
      if (v !== undefined) {
        merged[k] = v;
        if (k === "promisedDate" && isValidISODate(v)) {
          merged.dateAmbiguous = false;
        }
      }
    }
  }

  return merged;
};

/**
 * Validate draft parameters against live MongoDB entities (read-only) and build
 * proposed changes + clarification prompts without mutating business data.
 */
const validateAndPreviewDraft = async (category, draft) => {
  const validationErrors = [];
  const proposedChanges = [];
  let clarificationPrompt = null;

  if (category === "unclear") {
    validationErrors.push("Command intent could not be determined.");
    clarificationPrompt =
      "I could not understand the command clearly. Please specify whether this is a payment, inventory purchase/sale, product transformation, or customer query.";
    return { draft, validationErrors, proposedChanges, clarificationPrompt };
  }

  // Read-only customer intelligence queries
  if (READ_ONLY_CATEGORIES.has(category)) {
    if (!draft.customerId) {
      const msg = draft.mentionedCustomer
        ? `Customer "${draft.mentionedCustomer}" was not found in your directory. Which registered customer do you mean?`
        : "Please specify which customer you want to check.";
      validationErrors.push(msg);
      clarificationPrompt = msg;
    }
    return { draft, validationErrors, proposedChanges, clarificationPrompt };
  }

  // Payment commands
  if (
    category === "payment_received" ||
    category === "payment_promise" ||
    category === "partial_payment"
  ) {
    let customer = null;
    if (!draft.customerId || !mongoose.isValidObjectId(draft.customerId)) {
      validationErrors.push(
        draft.mentionedCustomer
          ? `Customer "${draft.mentionedCustomer}" is not in your directory.`
          : "Customer is required."
      );
    } else {
      customer = await Customer.findById(draft.customerId).lean();
      if (!customer) {
        validationErrors.push("Selected customer does not exist.");
      } else {
        draft.customerName = customer.name;
      }
    }

    const amt = Number(draft.amount);
    if (!Number.isFinite(amt) || amt < 1) {
      validationErrors.push("Valid amount of at least ₹1 is required.");
    }

    if (category === "payment_promise") {
      if (draft.dateAmbiguous) {
        validationErrors.push(
          "Promised date is ambiguous (for example, 'Friday' when today is Friday). Please provide an exact date or say 'today' / 'next Friday'."
        );
      } else if (!isValidISODate(draft.promisedDate)) {
        validationErrors.push(
          "Promised date in YYYY-MM-DD format is required."
        );
      }
    } else if (category === "payment_received") {
      if (draft.dateAmbiguous) {
        validationErrors.push(
          "Payment receipt date is ambiguous. Please confirm the date."
        );
      } else if (!draft.promisedDate) {
        // Explicit date missing on receipt: ask vendor to confirm today's date rather than silently guessing
        validationErrors.push(
          `Please confirm the payment received date (e.g. today ${getTodayIST()}).`
        );
      } else if (!isValidISODate(draft.promisedDate)) {
        validationErrors.push("Receipt date must be in YYYY-MM-DD format.");
      }
    } else if (category === "partial_payment") {
      if (customer) {
        const targetCommitment = draft.commitmentId
          ? await Commitment.findById(draft.commitmentId).lean()
          : await Commitment.findOne({
              customer: customer._id,
              confirmedByVendor: true,
              paymentStatus: "Unpaid",
            })
              .sort({ promisedDate: 1, createdAt: -1 })
              .lean();

        if (!targetCommitment) {
          validationErrors.push(
            `No active unpaid commitment found for ${customer.name} to record a partial payment against.`
          );
        } else {
          draft.commitmentId = targetCommitment._id.toString();
          if (Number.isFinite(amt) && amt > targetCommitment.amount) {
            validationErrors.push(
              `Partial payment (₹${amt}) exceeds outstanding commitment balance (₹${targetCommitment.amount}).`
            );
          } else if (Number.isFinite(amt) && amt >= 1) {
            const remaining = targetCommitment.amount - amt;
            proposedChanges.push(
              `Record partial payment of ₹${amt.toLocaleString("en-IN")} for ${customer.name}.`
            );
            proposedChanges.push(
              `Recalculate remaining balance on commitment from ₹${targetCommitment.amount.toLocaleString("en-IN")} to ₹${remaining.toLocaleString("en-IN")}.`
            );
          }
        }
      }
      if (
        draft.promisedDate &&
        !isValidISODate(draft.promisedDate)
      ) {
        validationErrors.push("Revised promised date must be in YYYY-MM-DD format.");
      }
    }

    if (validationErrors.length === 0) {
      if (category === "payment_promise") {
        proposedChanges.push(
          `Create Payment Promise for ${customer.name}: ₹${amt.toLocaleString("en-IN")} due on ${draft.promisedDate} (Pending / Unpaid).`
        );
      } else if (category === "payment_received") {
        proposedChanges.push(
          `Record Payment Received from ${customer.name}: ₹${amt.toLocaleString("en-IN")} on ${draft.promisedDate} (Paid / Kept).`
        );
      }
    } else {
      clarificationPrompt = validationErrors.join(" ");
    }

    return { draft, validationErrors, proposedChanges, clarificationPrompt };
  }

  // Inventory & transformation commands
  let product = null;
  if (!draft.productId || !mongoose.isValidObjectId(draft.productId)) {
    validationErrors.push(
      draft.mentionedProduct
        ? `Product "${draft.mentionedProduct}" was not found in inventory.`
        : "Product is required."
    );
  } else {
    product = await Product.findById(draft.productId).lean();
    if (!product) {
      validationErrors.push("Selected product does not exist.");
    } else {
      draft.productName = product.name;
      if (!draft.unit) {
        draft.unit = product.unit;
      }
    }
  }

  const qty = Number(draft.quantity);
  if (!Number.isFinite(qty) || qty <= 0) {
    validationErrors.push("Quantity must be greater than 0.");
  }

  if (draft.unit && !UNIT_SET.has(draft.unit)) {
    validationErrors.push(
      `Invalid unit "${draft.unit}". Allowed units: ${ALLOWED_INVENTORY_UNITS.join(", ")}.`
    );
  } else if (product && draft.unit) {
    try {
      convertQuantity(1, draft.unit, product.unit);
    } catch (err) {
      validationErrors.push(err.message);
    }
  }

  if (category === "inventory_purchase" && product && validationErrors.length === 0) {
    proposedChanges.push(
      `Add ${qty} ${draft.unit} to "${product.name}" (current stock: ${product.currentStock} ${product.unit}).`
    );
  }

  if (category === "inventory_deduction" && product && validationErrors.length === 0) {
    const qtyInProdUnit = convertQuantity(qty, draft.unit, product.unit);
    if (product.currentStock < qtyInProdUnit) {
      validationErrors.push(
        `Insufficient stock for "${product.name}": available ${product.currentStock} ${product.unit}, requested ${qtyInProdUnit} ${product.unit}.`
      );
    } else {
      proposedChanges.push(
        `Deduct ${qty} ${draft.unit} from "${product.name}" (remaining: ${Number((product.currentStock - qtyInProdUnit).toFixed(4))} ${product.unit}).`
      );
    }
  }

  if (category === "inventory_sale") {
    let customer = null;
    if (draft.customerId) {
      customer = await Customer.findById(draft.customerId).lean();
      if (!customer) {
        validationErrors.push("Selected customer does not exist.");
      } else {
        draft.customerName = customer.name;
      }
    } else if (draft.mentionedCustomer) {
      validationErrors.push(
        `Customer "${draft.mentionedCustomer}" was not found in your customer directory.`
      );
    }

    if (product && validationErrors.length === 0) {
      const qtyInProdUnit = convertQuantity(qty, draft.unit, product.unit);
      if (product.currentStock < qtyInProdUnit) {
        validationErrors.push(
          `Insufficient stock for "${product.name}": available ${product.currentStock} ${product.unit}, requested ${qtyInProdUnit} ${product.unit}.`
        );
      } else {
        let resolvedUnitPrice = draft.unitPrice;
        if (resolvedUnitPrice === null && customer) {
          const cp = await CustomerPrice.findOne({
            customer: customer._id,
            product: product._id,
          }).lean();
          if (cp) resolvedUnitPrice = cp.customPrice;
        }
        if (resolvedUnitPrice === null) {
          resolvedUnitPrice = product.sellingPrice;
        }
        if (resolvedUnitPrice === null || resolvedUnitPrice === undefined) {
          validationErrors.push(
            `Selling price is missing for "${product.name}". Please specify the rate.`
          );
        } else {
          draft.unitPrice = resolvedUnitPrice;
          proposedChanges.push(
            `Sell ${qty} ${draft.unit} of "${product.name}"${customer ? ` to ${customer.name}` : ""} at ₹${resolvedUnitPrice}/${draft.unit} (total ₹${Number((qty * resolvedUnitPrice).toFixed(2)).toLocaleString("en-IN")}).`
          );
        }
      }
    }
  }

  if (category === "product_transformation" && product) {
    // Auto-populate outputs from matching recipe if outputs were not explicitly specified
    if ((!draft.outputs || draft.outputs.length === 0) && Number.isFinite(qty) && qty > 0) {
      const recipe = draft.recipeId
        ? await TransformationRecipe.findById(draft.recipeId).populate("expectedOutputs.product", "name unit").lean()
        : await TransformationRecipe.findOne({ inputProduct: product._id }).populate("expectedOutputs.product", "name unit").lean();

      if (recipe && recipe.expectedOutputs?.length > 0) {
        draft.recipeId = recipe._id.toString();
        const scale =
          convertQuantity(qty, draft.unit || product.unit, recipe.inputUnit) /
          recipe.defaultInputQuantity;
        draft.outputs = recipe.expectedOutputs.map((o) => ({
          productId: o.product._id.toString(),
          productName: o.product.name,
          role: o.role,
          quantity: Number((o.expectedQuantity * scale).toFixed(4)),
          unit: o.unit,
        }));
        if (draft.processingLoss === null) {
          draft.processingLoss = Number((recipe.expectedLossQuantity * scale).toFixed(4));
        }
        if (draft.processingCost === null) {
          draft.processingCost = Number((recipe.defaultProcessingCost * scale).toFixed(2));
        }
      }
    }

    if (!draft.outputs || draft.outputs.length === 0) {
      validationErrors.push(
        "Please specify transformation outputs (or create a transformation recipe) before confirming."
      );
    }

    if (validationErrors.length === 0) {
      const qtyInProdUnit = convertQuantity(qty, draft.unit, product.unit);
      if (product.currentStock < qtyInProdUnit) {
        validationErrors.push(
          `Insufficient raw material "${product.name}": available ${product.currentStock} ${product.unit}, requested ${qtyInProdUnit} ${product.unit}.`
        );
      } else {
        const lossVal = draft.processingLoss ?? 0;
        const outputSummary = draft.outputs
          .map((o) => `${o.quantity} ${o.unit} ${o.productName} (${o.role})`)
          .join(", ");
        proposedChanges.push(
          `Transform ${qty} ${draft.unit} "${product.name}" → ${outputSummary}${lossVal > 0 ? `, loss: ${lossVal} ${draft.unit}` : ""}.`
        );
      }
    }
  }

  if (validationErrors.length > 0) {
    clarificationPrompt = validationErrors.join(" ");
  }

  return { draft, validationErrors, proposedChanges, clarificationPrompt };
};

const formatSessionResponse = (session, confirmationToken = null) => ({
  sessionId: session.sessionId,
  status: session.status,
  commandCategory: session.commandCategory,
  isReadOnly: session.isReadOnly,
  draft: session.draft,
  validationErrors: session.validationErrors,
  proposedChanges: session.proposedChanges,
  clarificationPrompt: session.clarificationPrompt,
  confirmationToken,
  expiresAt: session.expiresAt,
  executedAt: session.executedAt,
  executionResult: session.executionResult,
  turns: session.turns,
  auditTrail: session.auditTrail,
});

/**
 * Execute a confirmed session inside the appropriate existing domain service.
 */
export const confirmCommandSession = async ({
  sessionId,
  confirmationToken,
  idempotencyKey = null,
}) => {
  if (!sessionId || typeof sessionId !== "string") {
    throw new CommandOrchestratorError(400, "Valid sessionId is required");
  }

  const session = await CommandSession.findOne({ sessionId });
  if (!session) {
    throw new CommandOrchestratorError(404, "Command session not found");
  }
  if (session.status === "executed" || session.status === "executing") {
    throw new CommandOrchestratorError(
      409,
      "This command session has already been executed; replay blocked"
    );
  }
  if (session.status === "rejected") {
    throw new CommandOrchestratorError(
      409,
      "This command session was rejected and cannot be confirmed"
    );
  }
  if (session.status === "expired") {
    throw new CommandOrchestratorError(
      410,
      "Confirmation token has expired; please issue the command again"
    );
  }
  if (session.status !== "awaiting_confirmation") {
    throw new CommandOrchestratorError(
      400,
      session.clarificationPrompt ||
        "Command requires clarification before confirmation"
    );
  }

  const now = new Date();
  if (session.expiresAt && session.expiresAt <= now) {
    session.status = "expired";
    session.confirmationTokenHash = null;
    session.auditTrail.push({
      event: "session_expired",
      message: "Confirmation attempted after expiry",
      actor: "system",
      timestamp: now,
    });
    await session.save();
    throw new CommandOrchestratorError(
      410,
      "Confirmation token has expired; please issue the command again"
    );
  }

  if (!verifyTokenHash(confirmationToken, session.confirmationTokenHash)) {
    throw new CommandOrchestratorError(
      401,
      "Invalid or missing confirmationToken"
    );
  }

  const providedHash = hashToken(confirmationToken.trim());
  const lockedSession = await CommandSession.findOneAndUpdate(
    {
      _id: session._id,
      status: "awaiting_confirmation",
      confirmationTokenHash: providedHash,
      expiresAt: { $gt: now },
    },
    {
      $set: {
        status: "executing",
        confirmationTokenHash: null,
        executionIdempotencyKey: idempotencyKey || session.sessionId,
      },
    },
    { returnDocument: "after" }
  );

  if (!lockedSession) {
    throw new CommandOrchestratorError(
      409,
      "Confirmation token already consumed or session state changed"
    );
  }

  const d = lockedSession.draft || {};
  let executionResult;

  try {
    if (lockedSession.commandCategory === "payment_promise") {
      const { commitment } = await createConfirmedCommitment({
        customerId: d.customerId,
        amount: d.amount,
        promisedDate: d.promisedDate,
        originalMessage: d.originalMessage,
        transactionType: "payment_promise",
        confirmedByVendor: true,
        actor: "unified_command_confirmed",
      });
      executionResult = { type: "commitment", commitment };
    } else if (lockedSession.commandCategory === "payment_received") {
      const { commitment } = await createConfirmedCommitment({
        customerId: d.customerId,
        amount: d.amount,
        promisedDate: d.promisedDate,
        originalMessage: d.originalMessage,
        transactionType: "payment_received",
        confirmedByVendor: true,
        actor: "unified_command_confirmed",
      });
      executionResult = { type: "payment_received", commitment };
    } else if (lockedSession.commandCategory === "partial_payment") {
      const res = await recordPartialPaymentOnCommitment({
        commitmentId: d.commitmentId,
        partialAmount: d.amount,
        newPromisedDate: d.promisedDate,
        originalMessage: d.originalMessage,
        vendorNote: "Confirmed via unified command engine",
        actor: "unified_command_confirmed",
      });
      executionResult = {
        type: "partial_payment",
        commitment: res.commitment,
        partialPayment: res.partialPayment,
        appliedChanges: res.appliedChanges,
      };
    } else if (lockedSession.commandCategory === "inventory_purchase") {
      const res = await recordPurchase(d.productId, {
        quantity: d.quantity,
        unit: d.unit,
        unitCost: d.unitCost,
        note: d.originalMessage,
        idempotencyKey: lockedSession.executionIdempotencyKey,
      });
      executionResult = {
        type: "inventory_purchase",
        product: res.product,
        movement: res.movement,
      };
    } else if (lockedSession.commandCategory === "inventory_deduction") {
      const res = await recordDeduction(d.productId, {
        quantity: d.quantity,
        unit: d.unit,
        reason: "Unified command deduction",
        note: d.originalMessage,
      });
      executionResult = {
        type: "inventory_deduction",
        product: res.product,
        movement: res.movement,
      };
    } else if (lockedSession.commandCategory === "product_transformation") {
      const tx = await executeTransformation({
        recipeId: d.recipeId || null,
        inputProductId: d.productId,
        inputQuantity: d.quantity,
        inputUnit: d.unit,
        outputs: d.outputs,
        processingLoss: d.processingLoss ?? 0,
        lossUnit: d.unit,
        processingCost: d.processingCost ?? 0,
        idempotencyKey: lockedSession.executionIdempotencyKey,
        notes: d.originalMessage,
      });
      executionResult = { type: "product_transformation", transformation: tx };
    } else if (lockedSession.commandCategory === "inventory_sale") {
      const res = await recordSale({
        productId: d.productId,
        customerId: d.customerId || null,
        quantity: d.quantity,
        unit: d.unit,
        unitPrice: d.unitPrice,
        note: d.originalMessage,
        idempotencyKey: lockedSession.executionIdempotencyKey,
      });
      executionResult = {
        type: "inventory_sale",
        product: res.product,
        movement: res.movement,
        pricing: res.pricing,
      };
    } else {
      throw new CommandOrchestratorError(
        400,
        `Unsupported mutation category: ${lockedSession.commandCategory}`
      );
    }
  } catch (err) {
    // Restore awaiting_confirmation with a fresh token only if execution failed cleanly
    const reissue = issueConfirmationToken();
    lockedSession.status = "awaiting_confirmation";
    lockedSession.confirmationTokenHash = reissue.hash;
    lockedSession.expiresAt = reissue.expiresAt;
    lockedSession.auditTrail.push({
      event: "execution_failed",
      message: err.message,
      actor: "system",
      timestamp: new Date(),
    });
    await lockedSession.save();

    if (
      err instanceof CommitmentError ||
      err instanceof InventoryError ||
      err instanceof CustomerIntelligenceError
    ) {
      throw new CommandOrchestratorError(err.status, err.message, {
        confirmationToken: reissue.token,
      });
    }
    throw err;
  }

  const executedAt = new Date();
  lockedSession.status = "executed";
  lockedSession.executedAt = executedAt;
  lockedSession.executionResult = executionResult;
  lockedSession.turns.push({
    role: "system",
    text: `Confirmed and executed ${lockedSession.commandCategory}.`,
    timestamp: executedAt,
  });
  lockedSession.auditTrail.push({
    event: "confirmed_and_executed",
    message: `Executed ${lockedSession.commandCategory}`,
    draftSnapshot: d,
    actor: "vendor",
    timestamp: executedAt,
  });
  await lockedSession.save();

  return formatSessionResponse(lockedSession, null);
};

export const rejectCommandSession = async ({ sessionId, reason = null }) => {
  const session = await CommandSession.findOne({ sessionId });
  if (!session) {
    throw new CommandOrchestratorError(404, "Command session not found");
  }
  if (session.status === "executed") {
    throw new CommandOrchestratorError(
      409,
      "Already executed session cannot be rejected"
    );
  }

  session.status = "rejected";
  session.confirmationTokenHash = null;
  session.turns.push({
    role: "system",
    text: "Command cancelled by vendor. No database changes made.",
    timestamp: new Date(),
  });
  session.auditTrail.push({
    event: "rejected",
    message: reason || "Rejected by vendor",
    draftSnapshot: session.draft,
    actor: "vendor",
    timestamp: new Date(),
  });
  await session.save();

  return formatSessionResponse(session, null);
};

/**
 * Central conversational command handler supporting single-turn and multi-turn
 * preview, clarification, modification, confirmation, rejection, and read-only queries.
 */
export const handleUnifiedCommandMessage = async ({
  message,
  sessionId = null,
  confirmationToken = null,
  overrides = null,
}) => {
  if (typeof message !== "string" || !message.trim()) {
    throw new CommandOrchestratorError(400, "Command message is required");
  }
  const trimmed = message.trim();

  let activeSession = null;
  if (sessionId) {
    activeSession = await CommandSession.findOne({ sessionId });
    if (!activeSession) {
      throw new CommandOrchestratorError(404, "Command session not found");
    }
    if (activeSession.status === "executed") {
      throw new CommandOrchestratorError(
        409,
        "This command session is already executed; start a new session for a new command"
      );
    }
    if (activeSession.status === "rejected") {
      throw new CommandOrchestratorError(
        409,
        "This command session was cancelled; start a new session for a new command"
      );
    }
    if (
      activeSession.expiresAt &&
      activeSession.expiresAt <= new Date() &&
      activeSession.status === "awaiting_confirmation"
    ) {
      activeSession.status = "expired";
      activeSession.confirmationTokenHash = null;
      await activeSession.save();
      throw new CommandOrchestratorError(
        410,
        "This command session expired; please repeat your command"
      );
    }
  }

  // Deterministic handling for explicit confirm / reject on an active session
  if (activeSession && CONFIRM_PATTERN.test(trimmed)) {
    activeSession.turns.push({ role: "vendor", text: trimmed });
    await activeSession.save();
    return confirmCommandSession({
      sessionId: activeSession.sessionId,
      confirmationToken,
    });
  }

  if (activeSession && REJECT_PATTERN.test(trimmed)) {
    activeSession.turns.push({ role: "vendor", text: trimmed });
    await activeSession.save();
    return rejectCommandSession({
      sessionId: activeSession.sessionId,
      reason: trimmed,
    });
  }

  const [customers, products, recipes] = await Promise.all([
    Customer.find().lean(),
    Product.find({ isActive: true }).lean(),
    TransformationRecipe.find().lean(),
  ]);

  const interpreted = await interpretUnifiedCommand(trimmed, {
    customers,
    products,
    recipes,
    currentSession: activeSession,
  });

  if (activeSession && interpreted.commandCategory === "confirm_pending") {
    activeSession.turns.push({ role: "vendor", text: trimmed });
    await activeSession.save();
    return confirmCommandSession({
      sessionId: activeSession.sessionId,
      confirmationToken,
    });
  }

  if (activeSession && interpreted.commandCategory === "reject_pending") {
    activeSession.turns.push({ role: "vendor", text: trimmed });
    await activeSession.save();
    return rejectCommandSession({
      sessionId: activeSession.sessionId,
      reason: trimmed,
    });
  }

  let effectiveCategory = interpreted.commandCategory;
  if (activeSession && interpreted.commandCategory === "modify_pending") {
    effectiveCategory = activeSession.commandCategory;
  } else if (
    activeSession &&
    effectiveCategory === "unclear" &&
    activeSession.commandCategory !== "unclear" &&
    (interpreted.promisedDate ||
      interpreted.amount ||
      interpreted.customerId ||
      interpreted.productId ||
      interpreted.quantity ||
      interpreted.dateAmbiguous)
  ) {
    effectiveCategory = activeSession.commandCategory;
  }

  const draft = mergeDraft(
    activeSession ? activeSession.draft : {},
    interpreted,
    trimmed,
    overrides
  );

  const validation = await validateAndPreviewDraft(effectiveCategory, draft);

  // Read-only customer queries execute immediately when valid
  if (
    READ_ONLY_CATEGORIES.has(effectiveCategory) &&
    validation.validationErrors.length === 0
  ) {
    const intel = await buildCustomerIntelligence(draft.customerId);
    const lang = draft.language;
    let localizedInsights = null;
    if (lang && ["Gujarati", "Hindi", "Hinglish"].includes(lang)) {
      localizedInsights = await translateCustomerInsights(intel.insights, {
        customerName: intel.customer.name,
        targetLanguage: lang,
      });
    }

    const queryResult = {
      queryCategory: effectiveCategory,
      customer: intel.customer,
      financialProfile: intel.financialProfile,
      pattern: intel.pattern,
      riskAssessment: intel.riskAssessment,
      ...(effectiveCategory === "customer_outstanding_query"
        ? {
            outstandingBalance: intel.financialProfile.outstandingBalance,
            overdueOutstandingAmount:
              intel.financialProfile.overdueOutstandingAmount,
            overdueCommitmentsCount:
              intel.financialProfile.overdueCommitmentsCount,
            totalAmountPaid: intel.financialProfile.totalAmountPaid,
          }
        : {}),
      insights: intel.insights,
      ...(localizedInsights ? { localizedInsights } : {}),
    };

    const sess =
      activeSession ||
      new CommandSession({
        sessionId: crypto.randomUUID(),
      });
    sess.status = "executed";
    sess.commandCategory = effectiveCategory;
    sess.isReadOnly = true;
    sess.draft = validation.draft;
    sess.validationErrors = [];
    sess.proposedChanges = [];
    sess.clarificationPrompt = null;
    sess.confirmationTokenHash = null;
    sess.executedAt = new Date();
    sess.executionResult = queryResult;
    sess.turns.push({ role: "vendor", text: trimmed });
    sess.turns.push({
      role: "system",
      text: `Executed read-only ${effectiveCategory} for ${intel.customer.name}.`,
    });
    sess.auditTrail.push({
      event: "read_only_query_executed",
      message: trimmed,
      draftSnapshot: validation.draft,
      actor: "vendor",
    });
    await sess.save();

    return formatSessionResponse(sess, null);
  }

  // Mutation or clarification-needed preview
  const isReadyToConfirm =
    MUTATION_CATEGORIES.has(effectiveCategory) &&
    validation.validationErrors.length === 0;

  let issuedToken = null;
  let tokenHash = null;
  let expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  if (isReadyToConfirm) {
    const issued = issueConfirmationToken();
    issuedToken = issued.token;
    tokenHash = issued.hash;
    expiresAt = issued.expiresAt;
  }

  const sess =
    activeSession ||
    new CommandSession({
      sessionId: crypto.randomUUID(),
    });

  sess.status = isReadyToConfirm
    ? "awaiting_confirmation"
    : "awaiting_clarification";
  sess.commandCategory = effectiveCategory;
  sess.isReadOnly = READ_ONLY_CATEGORIES.has(effectiveCategory);
  sess.draft = validation.draft;
  sess.validationErrors = validation.validationErrors;
  sess.proposedChanges = validation.proposedChanges;
  sess.clarificationPrompt = validation.clarificationPrompt;
  sess.confirmationTokenHash = tokenHash;
  sess.expiresAt = expiresAt;
  sess.turns.push({ role: "vendor", text: trimmed });
  sess.turns.push({
    role: "system",
    text: isReadyToConfirm
      ? `Preview ready: ${validation.proposedChanges.join(" ")}`
      : validation.clarificationPrompt || "Clarification required.",
  });
  sess.auditTrail.push({
    event: activeSession ? "preview_updated" : "preview_created",
    message: trimmed,
    draftSnapshot: validation.draft,
    actor: "vendor",
  });
  await sess.save();

  return formatSessionResponse(sess, issuedToken);
};

export const getCommandSessionStatus = async (sessionId) => {
  const session = await CommandSession.findOne({ sessionId }).lean();
  if (!session) {
    throw new CommandOrchestratorError(404, "Command session not found");
  }
  return formatSessionResponse(session, null);
};

export const listRecentCommandSessions = async ({ limit = 15, category } = {}) => {
  const parsedLimit = Number(limit);
  const safeLimit =
    Number.isInteger(parsedLimit) && parsedLimit >= 1 && parsedLimit <= 50
      ? parsedLimit
      : 15;

  const filter = {};
  if (typeof category === "string" && category.trim()) {
    filter.commandCategory = category.trim();
  }

  const sessions = await CommandSession.find(filter)
    .select("-confirmationTokenHash")
    .sort({ updatedAt: -1 })
    .limit(safeLimit)
    .lean();

  return sessions.map((session) => formatSessionResponse(session, null));
};
