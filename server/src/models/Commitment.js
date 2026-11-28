
import mongoose from "mongoose";

const commitmentHistorySchema = new mongoose.Schema(
  {
    action: {
      type: String,
      required: true,
      trim: true,
    },
    previousAmount: { type: Number, default: null },
    newAmount: { type: Number, default: null },
    previousPromisedDate: { type: Date, default: null },
    newPromisedDate: { type: Date, default: null },
    previousStatus: { type: String, default: null },
    newStatus: { type: String, default: null },
    note: { type: String, default: null, trim: true },
    actor: { type: String, default: "vendor", trim: true },
    relatedReply: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CustomerReply",
      default: null,
    },
    relatedPartialPayment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Commitment",
      default: null,
    },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const commitmentSchema = new mongoose.Schema(
  {
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
    },

    amount: {
      type: Number,
      required: true,
      min: 1,
    },

    originalAmount: {
      type: Number,
      min: 1,
      default: null,
    },

    paidAmount: {
      type: Number,
      min: 0,
      default: 0,
    },

    promisedDate: {
      type: Date,
      required: true,
    },

    originalMessage: {
      type: String,
      required: true,
      trim: true,
    },

    status: {
      type: String,
      enum: ["Pending", "Kept", "Broken", "Renegotiated"],
      default: "Pending",
    },

    transactionType: {
      type: String,
      enum: ["payment_promise", "payment_received", "udhaar_balance"],
      default: "payment_promise",
    },

    parentCommitment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Commitment",
      default: null,
    },

    history: {
      type: [commitmentHistorySchema],
      default: [],
    },

    confirmedByVendor: {
      type: Boolean,
      default: false,
    },

    paymentStatus: {
      type: String,
      enum: ["Unpaid", "Paid"],
      default: "Unpaid",
    },

    paidAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

const Commitment = mongoose.model("Commitment", commitmentSchema);

export default Commitment;
