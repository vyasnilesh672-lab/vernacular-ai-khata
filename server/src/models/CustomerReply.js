import mongoose from "mongoose";

const customerReplySchema = new mongoose.Schema(
  {
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      default: null,
      index: true,
    },
    commitment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Commitment",
      default: null,
      index: true,
    },
    relatedReminder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Reminder",
      default: null,
    },
    fromPhone: {
      type: String,
      required: true,
      trim: true,
    },
    messageId: {
      type: String,
      default: null,
      index: true,
    },
    messageFingerprint: {
      type: String,
      required: true,
      index: true,
    },
    rawMessage: {
      type: String,
      required: true,
      trim: true,
    },
    channel: {
      type: String,
      enum: ["whatsapp_cloud", "mock", "manual"],
      default: "mock",
    },
    aiInterpretation: {
      classification: {
        type: String,
        enum: [
          "payment_completed",
          "partial_payment",
          "new_payment_promise",
          "request_for_extension",
          "unclear_response",
        ],
        required: true,
      },
      amount: {
        type: Number,
        default: null,
      },
      proposedDate: {
        type: String,
        default: null,
      },
      dateAmbiguous: {
        type: Boolean,
        default: false,
      },
      language: {
        type: String,
        default: null,
      },
      confidence: {
        type: Number,
        min: 0,
        max: 1,
        default: 0,
      },
      summary: {
        type: String,
        default: null,
      },
      requiresVendorConfirmation: {
        type: Boolean,
        default: true,
      },
      recommendedAction: {
        type: String,
        enum: [
          "confirm_payment_received",
          "confirm_partial_payment",
          "confirm_new_date",
          "clarify_with_vendor",
          "no_action",
        ],
        default: "clarify_with_vendor",
      },
    },
    confirmationStatus: {
      type: String,
      enum: [
        "pending_vendor_confirmation",
        "confirmed",
        "rejected",
        "no_action_needed",
      ],
      default: "pending_vendor_confirmation",
    },
    confirmedAt: {
      type: Date,
      default: null,
    },
    vendorNote: {
      type: String,
      default: null,
      trim: true,
    },
    appliedChanges: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  { timestamps: true }
);

const CustomerReply = mongoose.model("CustomerReply", customerReplySchema);

export default CustomerReply;
