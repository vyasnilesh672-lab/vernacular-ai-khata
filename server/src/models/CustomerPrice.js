import mongoose from "mongoose";
import { ALLOWED_INVENTORY_UNITS } from "./Product.js";

const customerPriceSchema = new mongoose.Schema(
  {
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true,
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },
    customPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    unit: {
      type: String,
      enum: ALLOWED_INVENTORY_UNITS,
      required: true,
    },
    note: {
      type: String,
      default: null,
      trim: true,
    },
    lastUsedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

customerPriceSchema.index({ customer: 1, product: 1 }, { unique: true });

const CustomerPrice = mongoose.model("CustomerPrice", customerPriceSchema);

export default CustomerPrice;
