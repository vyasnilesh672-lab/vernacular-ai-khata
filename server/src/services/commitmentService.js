import mongoose from "mongoose";
import Commitment from "../models/Commitment.js";
import Customer from "../models/Customer.js";

export class CommitmentError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const CUSTOMER_PROJECTION = "name phone preferredLanguage";
const ALLOWED_TRANSACTION_TYPES = new Set([
  "payment_promise",
  "payment_received",
  "udhaar_balance",
]);
const pendingCommitmentKeys = new Set();

export const isValidISODate = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)) &&
  new Date(`${value}T00:00:00.000Z`).toISOString().startsWith(value);

export const getTodayIST = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

/**
 * Validate and persist a vendor-confirmed commitment or direct payment receipt.
 * Shared across commitmentRoutes and the unified command engine.
 */
export const createConfirmedCommitment = async (payload = {}) => {
  const {
    customerId,
    customer,
    amount,
    promisedDate,
    originalMessage,
    confirmedByVendor,
    transactionType,
    actor = "vendor",
  } = payload;

  if (
    customerId !== undefined &&
    customer !== undefined &&
    customerId !== customer
  ) {
    throw new CommitmentError(400, "Conflicting customer and customerId fields");
  }

  const resolvedCustomerId =
    customerId ?? (typeof customer === "string" ? customer : undefined);

  if (!resolvedCustomerId || !mongoose.isValidObjectId(resolvedCustomerId)) {
    throw new CommitmentError(400, "Valid customer ID is required");
  }

  if (confirmedByVendor !== true) {
    throw new CommitmentError(400, "Vendor confirmation is required");
  }

  const resolvedTransactionType =
    transactionType === undefined ? "payment_promise" : transactionType;
  if (!ALLOWED_TRANSACTION_TYPES.has(resolvedTransactionType)) {
    throw new CommitmentError(400, "Invalid transaction type");
  }

  const parsedAmount =
    typeof amount === "number" ||
    (typeof amount === "string" && amount.trim() !== "")
      ? Number(amount)
      : NaN;

  if (!Number.isFinite(parsedAmount) || parsedAmount < 1) {
    throw new CommitmentError(400, "Valid amount of at least ₹1 is required");
  }

  if (!isValidISODate(promisedDate)) {
    throw new CommitmentError(
      400,
      "A valid date in YYYY-MM-DD format is required"
    );
  }

  if (typeof originalMessage !== "string" || !originalMessage.trim()) {
    throw new CommitmentError(400, "Original message is required");
  }

  const existingCustomer = await Customer.findById(resolvedCustomerId);
  if (!existingCustomer) {
    throw new CommitmentError(404, "Customer not found");
  }

  const trimmedMessage = originalMessage.trim();
  const normalizedPromisedDate = new Date(`${promisedDate}T00:00:00.000Z`);
  const dedupeKey = `${resolvedCustomerId}|${resolvedTransactionType}|${parsedAmount}|${promisedDate}|${trimmedMessage}`;

  if (pendingCommitmentKeys.has(dedupeKey)) {
    throw new CommitmentError(
      409,
      "Duplicate payment record submission is already in progress"
    );
  }

  pendingCommitmentKeys.add(dedupeKey);

  try {
    const duplicateCommitment = await Commitment.findOne({
      customer: resolvedCustomerId,
      transactionType: resolvedTransactionType,
      amount: parsedAmount,
      promisedDate: normalizedPromisedDate,
      originalMessage: trimmedMessage,
    });

    if (duplicateCommitment) {
      throw new CommitmentError(409, "Duplicate payment commitment already exists");
    }

    const isPaymentReceived = resolvedTransactionType === "payment_received";

    const commitment = await Commitment.create({
      customer: resolvedCustomerId,
      amount: parsedAmount,
      originalAmount: parsedAmount,
      paidAmount: isPaymentReceived ? parsedAmount : 0,
      promisedDate: normalizedPromisedDate,
      originalMessage: trimmedMessage,
      transactionType: resolvedTransactionType,
      status: isPaymentReceived ? "Kept" : "Pending",
      paymentStatus: isPaymentReceived ? "Paid" : "Unpaid",
      paidAt: isPaymentReceived ? new Date() : null,
      confirmedByVendor: true,
      history: [
        {
          action: isPaymentReceived
            ? "payment_received_created"
            : "commitment_created",
          previousAmount: null,
          newAmount: parsedAmount,
          previousPromisedDate: null,
          newPromisedDate: normalizedPromisedDate,
          previousStatus: null,
          newStatus: isPaymentReceived ? "Kept" : "Pending",
          note: trimmedMessage,
          actor,
        },
      ],
    });

    await commitment.populate("customer", CUSTOMER_PROJECTION);
    return { commitment, isPaymentReceived };
  } finally {
    pendingCommitmentKeys.delete(dedupeKey);
  }
};

/**
 * Record a vendor-confirmed partial payment against an existing unpaid commitment,
 * creating a separate payment_received record, recalculating remaining balance,
 * and preserving audit history.
 */
export const recordPartialPaymentOnCommitment = async ({
  commitmentId,
  partialAmount,
  newPromisedDate = null,
  originalMessage,
  vendorNote = null,
  relatedReplyId = null,
  actor = "vendor",
}) => {
  const commitment = await Commitment.findById(commitmentId);
  if (!commitment) {
    throw new CommitmentError(404, "Linked commitment not found");
  }
  if (commitment.confirmedByVendor !== true) {
    throw new CommitmentError(
      400,
      "Commitment must be confirmed by vendor before recording partial payment"
    );
  }
  if (commitment.paymentStatus === "Paid") {
    throw new CommitmentError(400, "Linked commitment is already marked as Paid");
  }

  const parsedPartial = Number(partialAmount);
  if (!Number.isFinite(parsedPartial) || parsedPartial < 1) {
    throw new CommitmentError(
      400,
      "Valid partial payment amount of at least ₹1 is required"
    );
  }
  if (parsedPartial > commitment.amount) {
    throw new CommitmentError(
      400,
      `Partial payment (₹${parsedPartial}) cannot exceed outstanding balance (₹${commitment.amount})`
    );
  }

  if (
    newPromisedDate !== undefined &&
    newPromisedDate !== null &&
    newPromisedDate !== "" &&
    !isValidISODate(newPromisedDate)
  ) {
    throw new CommitmentError(
      400,
      "Revised promised date must be in YYYY-MM-DD format"
    );
  }

  const now = new Date();
  const prevAmount = commitment.amount;
  const prevDate = commitment.promisedDate;
  const prevStatus = commitment.status;
  if (!commitment.originalAmount) {
    commitment.originalAmount = prevAmount;
  }

  const remaining = prevAmount - parsedPartial;
  let partialPaymentDoc = null;
  let appliedChanges = null;

  if (remaining === 0) {
    commitment.paidAmount = commitment.originalAmount;
    commitment.paymentStatus = "Paid";
    commitment.paidAt = now;
    commitment.status = "Kept";
    commitment.history.push({
      action: "full_payment_via_reply",
      previousAmount: prevAmount,
      newAmount: prevAmount,
      previousPromisedDate: prevDate,
      newPromisedDate: prevDate,
      previousStatus: prevStatus,
      newStatus: "Kept",
      note: vendorNote || "Final partial payment settled remaining balance",
      actor,
      relatedReply: relatedReplyId,
      createdAt: now,
    });
    await commitment.save();
    appliedChanges = {
      type: "partial_payment_settled_full",
      paidNow: parsedPartial,
      outstandingAmount: 0,
      paymentStatus: "Paid",
    };
  } else {
    const receiptDateISO = getTodayIST();
    partialPaymentDoc = await Commitment.create({
      customer: commitment.customer,
      amount: parsedPartial,
      originalAmount: parsedPartial,
      paidAmount: parsedPartial,
      promisedDate: new Date(`${receiptDateISO}T00:00:00.000Z`),
      originalMessage: originalMessage || `Partial payment of ₹${parsedPartial}`,
      transactionType: "payment_received",
      parentCommitment: commitment._id,
      status: "Kept",
      paymentStatus: "Paid",
      paidAt: now,
      confirmedByVendor: true,
    });

    const nextPromisedDate =
      newPromisedDate && isValidISODate(newPromisedDate)
        ? new Date(`${newPromisedDate}T00:00:00.000Z`)
        : prevDate;

    commitment.paidAmount = (commitment.paidAmount || 0) + parsedPartial;
    commitment.amount = remaining;
    commitment.promisedDate = nextPromisedDate;
    commitment.status = "Renegotiated";
    commitment.history.push({
      action: "partial_payment_recorded",
      previousAmount: prevAmount,
      newAmount: remaining,
      previousPromisedDate: prevDate,
      newPromisedDate: nextPromisedDate,
      previousStatus: prevStatus,
      newStatus: "Renegotiated",
      note:
        vendorNote ||
        `Recorded partial payment of ₹${parsedPartial}; remaining ₹${remaining}`,
      actor,
      relatedReply: relatedReplyId,
      relatedPartialPayment: partialPaymentDoc._id,
      createdAt: now,
    });
    await commitment.save();

    appliedChanges = {
      type: "partial_payment",
      partialPaymentId: partialPaymentDoc._id,
      partialPaymentAmount: parsedPartial,
      previousOutstanding: prevAmount,
      recalculatedOutstanding: remaining,
      promisedDate: nextPromisedDate,
    };
  }

  await commitment.populate("customer", CUSTOMER_PROJECTION);
  if (partialPaymentDoc) {
    await partialPaymentDoc.populate("customer", CUSTOMER_PROJECTION);
  }

  return { commitment, partialPayment: partialPaymentDoc, appliedChanges };
};
