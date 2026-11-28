import mongoose from "mongoose";

const commandTurnSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      enum: ["vendor", "system"],
      required: true,
    },
    text: {
      type: String,
      required: true,
      trim: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const commandAuditEntrySchema = new mongoose.Schema(
  {
    event: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      default: null,
      trim: true,
    },
    draftSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    actor: {
      type: String,
      default: "vendor",
      trim: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const commandSessionSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    status: {
      type: String,
      enum: [
        "awaiting_clarification",
        "awaiting_confirmation",
        "executing",
        "executed",
        "rejected",
        "expired",
      ],
      default: "awaiting_clarification",
    },
    commandCategory: {
      type: String,
      enum: [
        "payment_received",
        "payment_promise",
        "partial_payment",
        "inventory_purchase",
        "inventory_deduction",
        "product_transformation",
        "inventory_sale",
        "customer_info_query",
        "customer_outstanding_query",
        "customer_risk_query",
        "unclear",
      ],
      default: "unclear",
    },
    isReadOnly: {
      type: Boolean,
      default: false,
    },
    draft: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    validationErrors: {
      type: [String],
      default: [],
    },
    proposedChanges: {
      type: [String],
      default: [],
    },
    clarificationPrompt: {
      type: String,
      default: null,
    },
    confirmationTokenHash: {
      type: String,
      default: null,
      index: true,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
    executedAt: {
      type: Date,
      default: null,
    },
    executionIdempotencyKey: {
      type: String,
      default: null,
    },
    executionResult: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    turns: {
      type: [commandTurnSchema],
      default: [],
    },
    auditTrail: {
      type: [commandAuditEntrySchema],
      default: [],
    },
  },
  { timestamps: true }
);

const CommandSession = mongoose.model("CommandSession", commandSessionSchema);

export default CommandSession;
