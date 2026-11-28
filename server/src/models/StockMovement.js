import mongoose from "mongoose";
import { ALLOWED_INVENTORY_UNITS } from "./Product.js";

const stockMovementSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },
    movementType: {
      type: String,
      enum: [
        "purchase",
        "sale",
        "deduction",
        "transformation_input",
        "transformation_output",
        "transformation_byproduct",
        "adjustment",
      ],
      required: true,
    },
    quantityChange: {
      type: Number,
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 0,
    },
    unit: {
      type: String,
      enum: ALLOWED_INVENTORY_UNITS,
      required: true,
    },
    previousStock: {
      type: Number,
      required: true,
    },
    newStock: {
      type: Number,
      required: true,
    },
    unitCost: {
      type: Number,
      min: 0,
      default: null,
    },
    unitPrice: {
      type: Number,
      min: 0,
      default: null,
    },
    totalCost: {
      type: Number,
      min: 0,
      default: null,
    },
    totalRevenue: {
      type: Number,
      min: 0,
      default: null,
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      default: null,
      index: true,
    },
    transformation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Transformation",
      default: null,
      index: true,
    },
    reason: {
      type: String,
      default: null,
      trim: true,
    },
    note: {
      type: String,
      default: null,
      trim: true,
    },
    idempotencyKey: {
      type: String,
      default: null,
      index: true,
    },
    actor: {
      type: String,
      default: "vendor",
      trim: true,
    },
  },
  { timestamps: true }
);

const rejectHistoryMutation = function () {
  throw new Error("StockMovement history is immutable and cannot be modified");
};

stockMovementSchema.pre("updateOne", rejectHistoryMutation);
stockMovementSchema.pre("updateMany", rejectHistoryMutation);
stockMovementSchema.pre("findOneAndUpdate", rejectHistoryMutation);

const StockMovement = mongoose.model("StockMovement", stockMovementSchema);

export default StockMovement;
