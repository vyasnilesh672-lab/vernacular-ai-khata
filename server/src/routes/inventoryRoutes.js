import express from "express";
import mongoose from "mongoose";
import Product from "../models/Product.js";
import StockMovement from "../models/StockMovement.js";
import TransformationRecipe from "../models/TransformationRecipe.js";
import Transformation from "../models/Transformation.js";
import CustomerPrice from "../models/CustomerPrice.js";
import Customer from "../models/Customer.js";
import {
  InventoryError,
  createOrUpdateRecipe,
  createProduct,
  executeTransformation,
  getProfitAndLossReport,
  recordControlledAdjustment,
  recordDeduction,
  recordPurchase,
  recordSale,
  updateProductMetadata,
  upsertCustomerPrice,
} from "../services/inventoryService.js";
import { interpretInventoryCommand } from "../services/geminiService.js";

const router = express.Router();

const handleRouteError = (res, error) => {
  if (error instanceof InventoryError) {
    return res.status(error.status).json({
      success: false,
      message: error.message,
      ...error.extra,
    });
  }
  return res.status(500).json({
    success: false,
    message: error.message || "Inventory operation failed",
  });
};

// List products with low-stock flag
router.get("/products", async (req, res) => {
  try {
    const filter = { isActive: true };
    if (typeof req.query.category === "string" && req.query.category.trim()) {
      filter.category = req.query.category.trim();
    }
    if (typeof req.query.productRole === "string") {
      filter.productRole = req.query.productRole;
    }

    const products = await Product.find(filter).sort({ name: 1 });
    const data = products.map((p) => ({
      ...p.toObject(),
      isLowStock: p.currentStock <= p.minimumStockThreshold,
    }));

    res.json({
      success: true,
      count: data.length,
      data,
    });
  } catch (error) {
    handleRouteError(res, error);
  }
});

// Create product
router.post("/products", async (req, res) => {
  try {
    const product = await createProduct(req.body);
    res.status(201).json({
      success: true,
      message: "Product created successfully",
      data: product,
    });
  } catch (error) {
    handleRouteError(res, error);
  }
});

// Update product metadata (never overwrites stock directly)
router.patch("/products/:id", async (req, res) => {
  try {
    const product = await updateProductMetadata(req.params.id, req.body);
    res.json({
      success: true,
      message: "Product updated successfully",
      data: product,
    });
  } catch (error) {
    handleRouteError(res, error);
  }
});

// Stock purchase
router.post("/products/:id/purchase", async (req, res) => {
  try {
    const result = await recordPurchase(req.params.id, req.body);
    res.status(201).json({
      success: true,
      message: "Stock purchase recorded successfully",
      data: result,
    });
  } catch (error) {
    handleRouteError(res, error);
  }
});

// Stock deduction (non-sale usage/wastage, prevents negative stock)
router.post("/products/:id/deduct", async (req, res) => {
  try {
    const result = await recordDeduction(req.params.id, req.body);
    res.status(201).json({
      success: true,
      message: "Stock deduction recorded successfully",
      data: result,
    });
  } catch (error) {
    handleRouteError(res, error);
  }
});

// Controlled stock adjustment (requires explicit reason; negative requires allowNegative: true)
router.post("/products/:id/adjust", async (req, res) => {
  try {
    const result = await recordControlledAdjustment(req.params.id, req.body);
    res.status(201).json({
      success: true,
      message: "Controlled stock adjustment recorded",
      data: result,
    });
  } catch (error) {
    handleRouteError(res, error);
  }
});

// Immutable stock movement history
router.get("/movements", async (req, res) => {
  try {
    const filter = {};
    if (req.query.productId) {
      if (!mongoose.isValidObjectId(req.query.productId)) {
        return res.status(400).json({ success: false, message: "Invalid productId" });
      }
      filter.product = req.query.productId;
    }
    if (req.query.customerId) {
      if (!mongoose.isValidObjectId(req.query.customerId)) {
        return res.status(400).json({ success: false, message: "Invalid customerId" });
      }
      filter.customer = req.query.customerId;
    }
    if (typeof req.query.movementType === "string") {
      filter.movementType = req.query.movementType;
    }

    const movements = await StockMovement.find(filter)
      .populate("product", "name unit category")
      .populate("customer", "name phone")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: movements.length,
      data: movements,
    });
  } catch (error) {
    handleRouteError(res, error);
  }
});

// Vendor-defined transformation recipes
router.get("/recipes", async (req, res) => {
  try {
    const recipes = await TransformationRecipe.find()
      .populate("inputProduct", "name unit currentStock purchaseCost")
      .populate("expectedOutputs.product", "name unit currentStock sellingPrice")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: recipes.length,
      data: recipes,
    });
  } catch (error) {
    handleRouteError(res, error);
  }
});

router.post("/recipes", async (req, res) => {
  try {
    const recipe = await createOrUpdateRecipe(req.body);
    res.status(201).json({
      success: true,
      message: "Transformation recipe saved",
      data: recipe,
    });
  } catch (error) {
    handleRouteError(res, error);
  }
});

router.put("/recipes/:id", async (req, res) => {
  try {
    const recipe = await createOrUpdateRecipe(req.body, req.params.id);
    res.json({
      success: true,
      message: "Transformation recipe updated",
      data: recipe,
    });
  } catch (error) {
    handleRouteError(res, error);
  }
});

// Product transformation history & atomic execution
router.get("/transformations", async (req, res) => {
  try {
    const transformations = await Transformation.find()
      .populate("recipe", "name")
      .populate("input.product", "name unit")
      .populate("outputs.product", "name unit")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: transformations.length,
      data: transformations,
    });
  } catch (error) {
    handleRouteError(res, error);
  }
});

router.post("/transformations", async (req, res) => {
  try {
    const transformation = await executeTransformation(req.body);
    res.status(201).json({
      success: true,
      message: "Product transformation completed successfully",
      data: transformation,
    });
  } catch (error) {
    handleRouteError(res, error);
  }
});

// Customer-specific pricing
router.get("/customer-prices", async (req, res) => {
  try {
    const filter = {};
    if (req.query.customerId && mongoose.isValidObjectId(req.query.customerId)) {
      filter.customer = req.query.customerId;
    }
    if (req.query.productId && mongoose.isValidObjectId(req.query.productId)) {
      filter.product = req.query.productId;
    }

    const prices = await CustomerPrice.find(filter)
      .populate("customer", "name phone")
      .populate("product", "name unit sellingPrice")
      .sort({ updatedAt: -1 });

    res.json({
      success: true,
      count: prices.length,
      data: prices,
    });
  } catch (error) {
    handleRouteError(res, error);
  }
});

router.put("/customer-prices", async (req, res) => {
  try {
    const record = await upsertCustomerPrice(req.body);
    res.json({
      success: true,
      message: "Customer-specific price saved",
      data: record,
    });
  } catch (error) {
    handleRouteError(res, error);
  }
});

// Record sale with customer-specific or negotiated pricing
router.post("/sales", async (req, res) => {
  try {
    const result = await recordSale(req.body);
    res.status(201).json({
      success: true,
      message: "Sale recorded successfully",
      data: result,
    });
  } catch (error) {
    handleRouteError(res, error);
  }
});

// Profit & Loss intelligence report
router.get("/pnl", async (req, res) => {
  try {
    const report = await getProfitAndLossReport({
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      productId: req.query.productId,
      customerId: req.query.customerId,
    });
    res.json({
      success: true,
      data: report,
    });
  } catch (error) {
    handleRouteError(res, error);
  }
});

// Conversational inventory voice/text preparation preview (never mutates stock)
router.post("/ai/interpret", async (req, res) => {
  try {
    const { message } = req.body || {};
    if (typeof message !== "string" || !message.trim()) {
      return res.status(400).json({
        success: false,
        message: "Inventory command message is required",
      });
    }

    const [products, customers, recipes] = await Promise.all([
      Product.find({ isActive: true }),
      Customer.find(),
      TransformationRecipe.find(),
    ]);

    const interpreted = await interpretInventoryCommand(message.trim(), {
      products,
      customers,
      recipes,
    });

    res.json({
      success: true,
      message: "Inventory command interpreted for vendor confirmation",
      data: interpreted,
    });
  } catch (error) {
    handleRouteError(res, error);
  }
});

export default router;
