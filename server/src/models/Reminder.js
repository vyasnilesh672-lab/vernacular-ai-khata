import mongoose from "mongoose";

const reminderStatusEntrySchema = new mongoose.Schema(
  {
    status: {
      type: String,
      required: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
    detail: {
      type: String,
      default: null,
    },
  },
  { _id: false }
);

const reminderSchema = new mongoose.Schema(
  {
    commitment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Commitment",
      required: true,
      index: true,
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true,
    },
    reminderType: {
      type: String,
      enum: ["upcoming", "due_today", "overdue"],
      required: true,
    },
    reminderDateKey: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    language: {
      type: String,
      enum: ["Gujarati", "Hindi", "Hinglish", "English"],
      default: "Hindi",
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    channel: {
      type: String,
      enum: ["whatsapp_cloud", "mock"],
      required: true,
    },
    isMock: {
      type: Boolean,
      default: false,
    },
    deliveryStatus: {
      type: String,
      enum: ["pending", "mock_sent", "sent", "delivered", "read", "failed"],
      default: "pending",
    },
    providerMessageId: {
      type: String,
      default: null,
      index: true,
    },
    statusHistory: {
      type: [reminderStatusEntrySchema],
      default: [],
    },
    outstandingAmountSnapshot: {
      type: Number,
      required: true,
      min: 1,
    },
    promisedDateSnapshot: {
      type: Date,
      required: true,
    },
    sentAt: {
      type: Date,
      default: null,
    },
    errorMessage: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

const Reminder = mongoose.model("Reminder", reminderSchema);

export default Reminder;
