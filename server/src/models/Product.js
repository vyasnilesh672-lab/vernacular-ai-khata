import mongoose from "mongoose";

export const ALLOWED_INVENTORY_UNITS = [
  "kg",
  "gram",
  "litre",
  "ml",
  "piece",
  "packet",
  "peti",
  "katta",
  "nag",
  "bora",
  "box",
];

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    normalizedName: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    category: {
      type: String,
      required: true,
      trim: true,
    },
    productRole: {
      type: String,
      enum: ["raw_material", "finished_good", "by_product", "general"],
      default: "general",
    },
    currentStock: {
      type: Number,
      required: true,
      default: 0,
    },
    unit: {
      type: String,
      enum: ALLOWED_INVENTORY_UNITS,
      required: true,
    },
    purchaseCost: {
      type: Number,
      min: 0,
      default: null,
    },
    sellingPrice: {
      type: Number,
      min: 0,
      default: null,
    },
    minimumStockThreshold: {
      type: Number,
      min: 0,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

const Product = mongoose.model("Product", productSchema);

export default Product;
