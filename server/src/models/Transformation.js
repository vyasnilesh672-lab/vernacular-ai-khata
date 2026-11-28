import mongoose from "mongoose";
import { ALLOWED_INVENTORY_UNITS } from "./Product.js";

const transformationOutputSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    productName: {
      type: String,
      required: true,
      trim: true,
    },
    role: {
      type: String,
      enum: ["finished_good", "by_product"],
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 0.0001,
    },
    unit: {
      type: String,
      enum: ALLOWED_INVENTORY_UNITS,
      required: true,
    },
    unitSellingPrice: {
      type: Number,
      min: 0,
      default: null,
    },
    allocatedUnitCost: {
      type: Number,
      min: 0,
      default: null,
    },
    estimatedValue: {
      type: Number,
      min: 0,
      default: null,
    },
  },
  { _id: false }
);

const transformationSchema = new mongoose.Schema(
  {
    recipe: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TransformationRecipe",
      default: null,
    },
    idempotencyKey: {
      type: String,
      default: null,
      index: true,
    },
    requestFingerprint: {
      type: String,
      required: true,
      index: true,
    },
    input: {
      product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product",
        required: true,
      },
      productName: {
        type: String,
        required: true,
        trim: true,
      },
      quantity: {
        type: Number,
        required: true,
        min: 0.0001,
      },
      unit: {
        type: String,
        enum: ALLOWED_INVENTORY_UNITS,
        required: true,
      },
      unitCost: {
        type: Number,
        min: 0,
        default: null,
      },
      totalRawMaterialCost: {
        type: Number,
        min: 0,
        default: null,
      },
    },
    outputs: {
      type: [transformationOutputSchema],
      required: true,
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length > 0,
        message: "At least one transformation output is required",
      },
    },
    processingLoss: {
      type: Number,
      min: 0,
      default: 0,
    },
    lossUnit: {
      type: String,
      enum: ALLOWED_INVENTORY_UNITS,
      required: true,
    },
    totalOutputQuantity: {
      type: Number,
      required: true,
      min: 0,
    },
    primaryOutputQuantity: {
      type: Number,
      required: true,
      min: 0,
    },
    yieldPercentage: {
      type: Number,
      required: true,
      min: 0,
    },
    totalRecoveryPercentage: {
      type: Number,
      required: true,
      min: 0,
    },
    processingCost: {
      type: Number,
      min: 0,
      default: 0,
    },
    totalInputCost: {
      type: Number,
      min: 0,
      default: null,
    },
    byProductEstimatedValue: {
      type: Number,
      min: 0,
      default: 0,
    },
    estimatedLossValue: {
      type: Number,
      min: 0,
      default: null,
    },
    costComplete: {
      type: Boolean,
      required: true,
    },
    batchReference: {
      type: String,
      default: null,
      trim: true,
    },
    notes: {
      type: String,
      default: null,
      trim: true,
    },
  },
  { timestamps: true }
);

const Transformation = mongoose.model("Transformation", transformationSchema);

export default Transformation;
