
import mongoose from "mongoose";

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
