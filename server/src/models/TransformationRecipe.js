import mongoose from "mongoose";
import { ALLOWED_INVENTORY_UNITS } from "./Product.js";

const expectedOutputSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    role: {
      type: String,
      enum: ["finished_good", "by_product"],
      required: true,
    },
    expectedQuantity: {
      type: Number,
      required: true,
      min: 0.0001,
    },
    unit: {
      type: String,
      enum: ALLOWED_INVENTORY_UNITS,
      required: true,
    },
  },
  { _id: false }
);

const transformationRecipeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    inputProduct: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    defaultInputQuantity: {
      type: Number,
      required: true,
      min: 0.0001,
    },
    inputUnit: {
      type: String,
      enum: ALLOWED_INVENTORY_UNITS,
      required: true,
    },
    expectedOutputs: {
      type: [expectedOutputSchema],
      default: [],
    },
    expectedLossQuantity: {
      type: Number,
      min: 0,
      default: 0,
    },
    defaultProcessingCost: {
      type: Number,
      min: 0,
      default: 0,
    },
    notes: {
      type: String,
      default: null,
      trim: true,
    },
  },
  { timestamps: true }
);

const TransformationRecipe = mongoose.model(
  "TransformationRecipe",
  transformationRecipeSchema
);

export default TransformationRecipe;
