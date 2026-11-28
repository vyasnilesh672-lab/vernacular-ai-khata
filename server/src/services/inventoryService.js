import crypto from "node:crypto";
import mongoose from "mongoose";
import Product, { ALLOWED_INVENTORY_UNITS } from "../models/Product.js";
import StockMovement from "../models/StockMovement.js";
import TransformationRecipe from "../models/TransformationRecipe.js";
import Transformation from "../models/Transformation.js";
import CustomerPrice from "../models/CustomerPrice.js";
import Customer from "../models/Customer.js";

export class InventoryError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const UNIT_SET = new Set(ALLOWED_INVENTORY_UNITS);
const UNIT_CONVERSION = {
  kg: { family: "weight", factorToBase: 1000 },
  gram: { family: "weight", factorToBase: 1 },
  litre: { family: "volume", factorToBase: 1000 },
  ml: { family: "volume", factorToBase: 1 },
};

const inFlightTransformationKeys = new Set();

export const validateUnit = (unit, fieldName = "unit") => {
  if (typeof unit !== "string") {
    throw new InventoryError(400, `Valid ${fieldName} is required`);
  }
  const normalized = unit.trim().toLowerCase();
  if (!UNIT_SET.has(normalized)) {
    throw new InventoryError(
      400,
      `Invalid ${fieldName}: "${unit}". Allowed units: ${ALLOWED_INVENTORY_UNITS.join(", ")}`
    );
  }
  return normalized;
};

export const parsePositiveNumber = (value, fieldName) => {
  const num =
    typeof value === "number" ||
    (typeof value === "string" && value.trim() !== "")
      ? Number(value)
      : NaN;
  if (!Number.isFinite(num) || num <= 0) {
    throw new InventoryError(400, `${fieldName} must be a positive number`);
  }
  return num;
};

export const parseNonNegativeNumber = (value, fieldName) => {
  const num =
    typeof value === "number" ||
    (typeof value === "string" && value.trim() !== "")
      ? Number(value)
      : NaN;
  if (!Number.isFinite(num) || num < 0) {
    throw new InventoryError(
      400,
      `${fieldName} must be a non-negative number`
    );
  }
  return num;
};

export const parseOptionalNonNegativeNumber = (value, fieldName) => {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return parseNonNegativeNumber(value, fieldName);
};

export const convertQuantity = (quantity, fromUnit, toUnit) => {
  if (fromUnit === toUnit) return quantity;
  const fromMeta = UNIT_CONVERSION[fromUnit];
  const toMeta = UNIT_CONVERSION[toUnit];
  if (!fromMeta || !toMeta || fromMeta.family !== toMeta.family) {
    throw new InventoryError(
      400,
      `Incompatible units: cannot convert from "${fromUnit}" to "${toUnit}"`
    );
  }
  return (quantity * fromMeta.factorToBase) / toMeta.factorToBase;
};

const roundQty = (num) => Number(Number(num).toFixed(4));
const roundMoney = (num) => Number(Number(num).toFixed(2));

/**
 * Execute operations inside a MongoDB ACID transaction when supported (replica set).
 */
export const runInTransaction = async (work) => {
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
};

export const createProduct = async (payload = {}) => {
  const {
    name,
    category,
    productRole = "general",
    currentStock = 0,
    unit,
    purchaseCost = null,
    sellingPrice = null,
    minimumStockThreshold = 0,
  } = payload;

  if (typeof name !== "string" || !name.trim()) {
    throw new InventoryError(400, "Product name is required");
  }
  if (typeof category !== "string" || !category.trim()) {
    throw new InventoryError(400, "Product category is required");
  }

  const normalizedUnit = validateUnit(unit, "unit");
  const initialStock = parseNonNegativeNumber(currentStock, "currentStock");
  const parsedPurchaseCost = parseOptionalNonNegativeNumber(
    purchaseCost,
    "purchaseCost"
  );
  const parsedSellingPrice = parseOptionalNonNegativeNumber(
    sellingPrice,
    "sellingPrice"
  );
  const parsedThreshold = parseNonNegativeNumber(
    minimumStockThreshold,
    "minimumStockThreshold"
  );

  const normalizedName = name.trim().toLowerCase();
  const existing = await Product.findOne({ normalizedName });
  if (existing) {
    throw new InventoryError(409, `Product "${name.trim()}" already exists`);
  }

  return runInTransaction(async (session) => {
    const [product] = await Product.create(
      [
        {
          name: name.trim(),
          normalizedName,
          category: category.trim(),
          productRole,
          currentStock: initialStock,
          unit: normalizedUnit,
          purchaseCost: parsedPurchaseCost,
          sellingPrice: parsedSellingPrice,
          minimumStockThreshold: parsedThreshold,
        },
      ],
      { session }
    );

    if (initialStock > 0) {
      await StockMovement.create(
        [
          {
            product: product._id,
            movementType: "purchase",
            quantityChange: initialStock,
            quantity: initialStock,
            unit: normalizedUnit,
            previousStock: 0,
            newStock: initialStock,
            unitCost: parsedPurchaseCost,
            totalCost:
              parsedPurchaseCost !== null
                ? roundMoney(initialStock * parsedPurchaseCost)
                : null,
            reason: "Opening stock",
            note: "Initial product stock",
          },
        ],
        { session }
      );
    }

    return product;
  });
};

export const updateProductMetadata = async (productId, payload = {}) => {
  if (!mongoose.isValidObjectId(productId)) {
    throw new InventoryError(400, "Invalid product ID");
  }
  if (payload.currentStock !== undefined) {
    throw new InventoryError(
      400,
      "Direct stock overwrites are not allowed; use purchase, deduct, sale, adjust, or transformation endpoints"
    );
  }

  const product = await Product.findById(productId);
  if (!product) {
    throw new InventoryError(404, "Product not found");
  }

  if (payload.name !== undefined) {
    if (typeof payload.name !== "string" || !payload.name.trim()) {
      throw new InventoryError(400, "Product name cannot be empty");
    }
    const normalizedName = payload.name.trim().toLowerCase();
    const conflict = await Product.findOne({
      normalizedName,
      _id: { $ne: product._id },
    });
    if (conflict) {
      throw new InventoryError(
        409,
        `Another product named "${payload.name.trim()}" already exists`
      );
    }
    product.name = payload.name.trim();
    product.normalizedName = normalizedName;
  }

  if (payload.category !== undefined) {
    if (typeof payload.category !== "string" || !payload.category.trim()) {
      throw new InventoryError(400, "Product category cannot be empty");
    }
    product.category = payload.category.trim();
  }

  if (payload.productRole !== undefined) {
    const allowedRoles = ["raw_material", "finished_good", "by_product", "general"];
    if (!allowedRoles.includes(payload.productRole)) {
      throw new InventoryError(400, "Invalid productRole");
    }
    product.productRole = payload.productRole;
  }

  if (payload.purchaseCost !== undefined) {
    product.purchaseCost = parseOptionalNonNegativeNumber(
      payload.purchaseCost,
      "purchaseCost"
    );
  }

  if (payload.sellingPrice !== undefined) {
    product.sellingPrice = parseOptionalNonNegativeNumber(
      payload.sellingPrice,
      "sellingPrice"
    );
  }

  if (payload.minimumStockThreshold !== undefined) {
    product.minimumStockThreshold = parseNonNegativeNumber(
      payload.minimumStockThreshold,
      "minimumStockThreshold"
    );
  }

  await product.save();
  return product;
};

export const recordPurchase = async (productId, payload = {}) => {
  if (!mongoose.isValidObjectId(productId)) {
    throw new InventoryError(400, "Invalid product ID");
  }

  const quantity = parsePositiveNumber(payload.quantity, "quantity");
  const parsedUnitCost = parseOptionalNonNegativeNumber(
    payload.unitCost,
    "unitCost"
  );
  const idempotencyKey =
    typeof payload.idempotencyKey === "string" && payload.idempotencyKey.trim()
      ? payload.idempotencyKey.trim()
      : null;

  if (idempotencyKey) {
    const existing = await StockMovement.findOne({
      product: productId,
      movementType: "purchase",
      idempotencyKey,
    });
    if (existing) {
      throw new InventoryError(409, "Duplicate stock purchase request", {
        movement: existing,
      });
    }
  }

  return runInTransaction(async (session) => {
    const product = await Product.findById(productId).session(session);
    if (!product) {
      throw new InventoryError(404, "Product not found");
    }

    const txUnit = payload.unit
      ? validateUnit(payload.unit, "unit")
      : product.unit;
    const qtyInProductUnit = roundQty(
      convertQuantity(quantity, txUnit, product.unit)
    );

    const prevStock = product.currentStock;
    const newStock = roundQty(prevStock + qtyInProductUnit);

    const effectiveUnitCost =
      parsedUnitCost !== null
        ? parsedUnitCost
        : product.purchaseCost !== null
          ? roundMoney((product.purchaseCost * qtyInProductUnit) / quantity)
          : null;

    const totalCost =
      effectiveUnitCost !== null
        ? roundMoney(quantity * effectiveUnitCost)
        : null;

    if (totalCost !== null && newStock > 0) {
      if (product.purchaseCost !== null && prevStock > 0) {
        const prevValue = prevStock * product.purchaseCost;
        product.purchaseCost = roundMoney((prevValue + totalCost) / newStock);
      } else {
        product.purchaseCost = roundMoney(totalCost / qtyInProductUnit);
      }
    }

    product.currentStock = newStock;
    await product.save({ session });

    const [movement] = await StockMovement.create(
      [
        {
          product: product._id,
          movementType: "purchase",
          quantityChange: qtyInProductUnit,
          quantity: qtyInProductUnit,
          unit: product.unit,
          previousStock: prevStock,
          newStock,
          unitCost:
            totalCost !== null
              ? roundMoney(totalCost / qtyInProductUnit)
              : null,
          totalCost,
          reason: payload.reason || "Stock purchase",
          note:
            payload.note ||
            (txUnit !== product.unit
              ? `Purchased ${quantity} ${txUnit} (${qtyInProductUnit} ${product.unit})`
              : null),
          idempotencyKey,
        },
      ],
      { session }
    );

    return { product, movement };
  });
};

export const recordDeduction = async (productId, payload = {}) => {
  if (!mongoose.isValidObjectId(productId)) {
    throw new InventoryError(400, "Invalid product ID");
  }

  const quantity = parsePositiveNumber(payload.quantity, "quantity");

  return runInTransaction(async (session) => {
    const product = await Product.findById(productId).session(session);
    if (!product) {
      throw new InventoryError(404, "Product not found");
    }

    const txUnit = payload.unit
      ? validateUnit(payload.unit, "unit")
      : product.unit;
    const qtyInProductUnit = roundQty(
      convertQuantity(quantity, txUnit, product.unit)
    );

    if (product.currentStock < qtyInProductUnit) {
      throw new InventoryError(
        400,
        `Insufficient stock for "${product.name}". Available: ${product.currentStock} ${product.unit}, requested: ${qtyInProductUnit} ${product.unit}`
      );
    }

    const prevStock = product.currentStock;
    const newStock = roundQty(prevStock - qtyInProductUnit);
    product.currentStock = newStock;
    await product.save({ session });

    const unitCost = product.purchaseCost;
    const totalCost =
      unitCost !== null ? roundMoney(qtyInProductUnit * unitCost) : null;

    const [movement] = await StockMovement.create(
      [
        {
          product: product._id,
          movementType: "deduction",
          quantityChange: -qtyInProductUnit,
          quantity: qtyInProductUnit,
          unit: product.unit,
          previousStock: prevStock,
          newStock,
          unitCost,
          totalCost,
          reason: payload.reason || "Manual stock deduction",
          note: payload.note || null,
        },
      ],
      { session }
    );

    return { product, movement };
  });
};

export const recordControlledAdjustment = async (productId, payload = {}) => {
  if (!mongoose.isValidObjectId(productId)) {
    throw new InventoryError(400, "Invalid product ID");
  }

  const { quantityDelta, reason, allowNegative = false, note } = payload;
  const parsedDelta =
    typeof quantityDelta === "number" ||
    (typeof quantityDelta === "string" && quantityDelta.trim() !== "")
      ? Number(quantityDelta)
      : NaN;

  if (!Number.isFinite(parsedDelta) || parsedDelta === 0) {
    throw new InventoryError(400, "Non-zero quantityDelta is required");
  }
  if (typeof reason !== "string" || !reason.trim()) {
    throw new InventoryError(
      400,
      "Adjustment reason is required for controlled stock adjustment"
    );
  }

  return runInTransaction(async (session) => {
    const product = await Product.findById(productId).session(session);
    if (!product) {
      throw new InventoryError(404, "Product not found");
    }

    const txUnit = payload.unit
      ? validateUnit(payload.unit, "unit")
      : product.unit;
    const deltaInProductUnit = roundQty(
      convertQuantity(parsedDelta, txUnit, product.unit)
    );

    const prevStock = product.currentStock;
    const newStock = roundQty(prevStock + deltaInProductUnit);

    if (newStock < 0 && allowNegative !== true) {
      throw new InventoryError(
        400,
        `Adjustment would make stock negative (${newStock} ${product.unit}). Pass allowNegative: true explicitly if intended.`
      );
    }

    product.currentStock = newStock;
    await product.save({ session });

    const [movement] = await StockMovement.create(
      [
        {
          product: product._id,
          movementType: "adjustment",
          quantityChange: deltaInProductUnit,
          quantity: Math.abs(deltaInProductUnit),
          unit: product.unit,
          previousStock: prevStock,
          newStock,
          unitCost: product.purchaseCost,
          totalCost:
            product.purchaseCost !== null
              ? roundMoney(Math.abs(deltaInProductUnit) * product.purchaseCost)
              : null,
          reason: reason.trim(),
          note: note || null,
        },
      ],
      { session }
    );

    return { product, movement };
  });
};

export const upsertCustomerPrice = async (payload = {}) => {
  const { customerId, productId, customPrice, unit, note = null } = payload;

  if (!customerId || !mongoose.isValidObjectId(customerId)) {
    throw new InventoryError(400, "Valid customerId is required");
  }
  if (!productId || !mongoose.isValidObjectId(productId)) {
    throw new InventoryError(400, "Valid productId is required");
  }
  const price = parseNonNegativeNumber(customPrice, "customPrice");

  const [customer, product] = await Promise.all([
    Customer.findById(customerId),
    Product.findById(productId),
  ]);
  if (!customer) throw new InventoryError(404, "Customer not found");
  if (!product) throw new InventoryError(404, "Product not found");

  const resolvedUnit = unit ? validateUnit(unit, "unit") : product.unit;
  // Validate unit compatibility with product's unit
  convertQuantity(1, resolvedUnit, product.unit);

  const record = await CustomerPrice.findOneAndUpdate(
    { customer: customer._id, product: product._id },
    {
      customer: customer._id,
      product: product._id,
      customPrice: price,
      unit: resolvedUnit,
      note: typeof note === "string" && note.trim() ? note.trim() : null,
    },
    { upsert: true, new: true, runValidators: true }
  )
    .populate("customer", "name phone")
    .populate("product", "name unit sellingPrice");

  return record;
};

/**
 * Record a product sale with customer-specific or negotiated pricing.
 * Never overwrites Product.sellingPrice.
 */
export const recordSale = async (payload = {}) => {
  const {
    productId,
    customerId = null,
    quantity,
    unit,
    unitPrice = null,
    saveAsCustomerPrice = false,
    note = null,
    idempotencyKey = null,
  } = payload;

  if (!productId || !mongoose.isValidObjectId(productId)) {
    throw new InventoryError(400, "Valid productId is required");
  }
  if (customerId !== null && !mongoose.isValidObjectId(customerId)) {
    throw new InventoryError(400, "Invalid customerId");
  }

  const parsedQty = parsePositiveNumber(quantity, "quantity");
  const explicitPrice = parseOptionalNonNegativeNumber(unitPrice, "unitPrice");

  if (idempotencyKey) {
    const existing = await StockMovement.findOne({
      product: productId,
      movementType: "sale",
      idempotencyKey: String(idempotencyKey).trim(),
    });
    if (existing) {
      throw new InventoryError(409, "Duplicate sale request", {
        movement: existing,
      });
    }
  }

  return runInTransaction(async (session) => {
    const product = await Product.findById(productId).session(session);
    if (!product) {
      throw new InventoryError(404, "Product not found");
    }

    let customer = null;
    if (customerId) {
      customer = await Customer.findById(customerId).session(session);
      if (!customer) {
        throw new InventoryError(404, "Customer not found");
      }
    }

    const saleUnit = unit ? validateUnit(unit, "unit") : product.unit;
    const qtyInProductUnit = roundQty(
      convertQuantity(parsedQty, saleUnit, product.unit)
    );

    if (product.currentStock < qtyInProductUnit) {
      throw new InventoryError(
        400,
        `Insufficient stock for "${product.name}". Available: ${product.currentStock} ${product.unit}, requested: ${qtyInProductUnit} ${product.unit}`
      );
    }

    let priceSource = "default_product_price";
    let totalRevenue = null;
    let effectivePricePerProductUnit = null;

    if (explicitPrice !== null) {
      priceSource = customerId ? "negotiated_customer_rate" : "negotiated_rate";
      totalRevenue = roundMoney(parsedQty * explicitPrice);
      effectivePricePerProductUnit = roundMoney(totalRevenue / qtyInProductUnit);
    } else if (customerId) {
      const custPrice = await CustomerPrice.findOne({
        customer: customerId,
        product: product._id,
      }).session(session);

      if (custPrice) {
        priceSource = "customer_specific_price";
        const qtyInCustUnit = convertQuantity(
          parsedQty,
          saleUnit,
          custPrice.unit
        );
        totalRevenue = roundMoney(qtyInCustUnit * custPrice.customPrice);
        effectivePricePerProductUnit = roundMoney(
          totalRevenue / qtyInProductUnit
        );
        custPrice.lastUsedAt = new Date();
        await custPrice.save({ session });
      }
    }

    if (totalRevenue === null) {
      if (product.sellingPrice === null || product.sellingPrice === undefined) {
        throw new InventoryError(
          400,
          `Selling price is missing for "${product.name}". Provide unitPrice or set a product/customer selling price.`
        );
      }
      effectivePricePerProductUnit = product.sellingPrice;
      totalRevenue = roundMoney(qtyInProductUnit * product.sellingPrice);
    }

    const prevStock = product.currentStock;
    const newStock = roundQty(prevStock - qtyInProductUnit);
    product.currentStock = newStock;
    await product.save({ session });

    const unitCost = product.purchaseCost;
    const totalCost =
      unitCost !== null ? roundMoney(qtyInProductUnit * unitCost) : null;

    if (saveAsCustomerPrice === true && customerId && explicitPrice !== null) {
      await CustomerPrice.findOneAndUpdate(
        { customer: customerId, product: product._id },
        {
          customer: customerId,
          product: product._id,
          customPrice: explicitPrice,
          unit: saleUnit,
          lastUsedAt: new Date(),
        },
        { upsert: true, session }
      );
    }

    const [movement] = await StockMovement.create(
      [
        {
          product: product._id,
          movementType: "sale",
          quantityChange: -qtyInProductUnit,
          quantity: qtyInProductUnit,
          unit: product.unit,
          previousStock: prevStock,
          newStock,
          unitCost,
          unitPrice: effectivePricePerProductUnit,
          totalCost,
          totalRevenue,
          customer: customer?._id || null,
          reason: `Sale (${priceSource})`,
          note,
          idempotencyKey: idempotencyKey ? String(idempotencyKey).trim() : null,
        },
      ],
      { session }
    );

    await movement.populate("product", "name unit sellingPrice purchaseCost");
    if (customer) {
      await movement.populate("customer", "name phone");
    }

    return {
      product,
      movement,
      pricing: {
        priceSource,
        unitPricePerProductUnit: effectivePricePerProductUnit,
        totalRevenue,
        productDefaultPricePreserved: product.sellingPrice,
      },
    };
  });
};

export const createOrUpdateRecipe = async (payload = {}, recipeId = null) => {
  const {
    name,
    inputProductId,
    defaultInputQuantity,
    inputUnit,
    expectedOutputs = [],
    expectedLossQuantity = 0,
    defaultProcessingCost = 0,
    notes = null,
  } = payload;

  if (typeof name !== "string" || !name.trim()) {
    throw new InventoryError(400, "Recipe name is required");
  }
  if (!inputProductId || !mongoose.isValidObjectId(inputProductId)) {
    throw new InventoryError(400, "Valid inputProductId is required");
  }
  const inputQty = parsePositiveNumber(
    defaultInputQuantity,
    "defaultInputQuantity"
  );
  const normalizedInputUnit = validateUnit(inputUnit, "inputUnit");
  const lossQty = parseNonNegativeNumber(
    expectedLossQuantity,
    "expectedLossQuantity"
  );
  const procCost = parseNonNegativeNumber(
    defaultProcessingCost,
    "defaultProcessingCost"
  );

  const inputProduct = await Product.findById(inputProductId);
  if (!inputProduct) {
    throw new InventoryError(404, "Input product not found");
  }
  convertQuantity(inputQty, normalizedInputUnit, inputProduct.unit);

  if (!Array.isArray(expectedOutputs) || expectedOutputs.length === 0) {
    throw new InventoryError(400, "At least one expected output is required");
  }

  const normalizedOutputs = [];
  for (const out of expectedOutputs) {
    if (!out?.productId || !mongoose.isValidObjectId(out.productId)) {
      throw new InventoryError(400, "Valid output productId is required");
    }
    const outProduct = await Product.findById(out.productId);
    if (!outProduct) {
      throw new InventoryError(404, `Output product ${out.productId} not found`);
    }
    const outUnit = validateUnit(out.unit || outProduct.unit, "output unit");
    const outQty = parsePositiveNumber(
      out.expectedQuantity,
      "expectedQuantity"
    );
    convertQuantity(outQty, outUnit, outProduct.unit);

    const role = out.role === "by_product" ? "by_product" : "finished_good";
    normalizedOutputs.push({
      product: outProduct._id,
      role,
      expectedQuantity: outQty,
      unit: outUnit,
    });
  }

  if (recipeId) {
    if (!mongoose.isValidObjectId(recipeId)) {
      throw new InventoryError(400, "Invalid recipe ID");
    }
    const updated = await TransformationRecipe.findByIdAndUpdate(
      recipeId,
      {
        name: name.trim(),
        inputProduct: inputProduct._id,
        defaultInputQuantity: inputQty,
        inputUnit: normalizedInputUnit,
        expectedOutputs: normalizedOutputs,
        expectedLossQuantity: lossQty,
        defaultProcessingCost: procCost,
        notes,
      },
      { new: true, runValidators: true }
    )
      .populate("inputProduct", "name unit currentStock purchaseCost")
      .populate("expectedOutputs.product", "name unit currentStock sellingPrice");

    if (!updated) throw new InventoryError(404, "Recipe not found");
    return updated;
  }

  const recipe = await TransformationRecipe.create({
    name: name.trim(),
    inputProduct: inputProduct._id,
    defaultInputQuantity: inputQty,
    inputUnit: normalizedInputUnit,
    expectedOutputs: normalizedOutputs,
    expectedLossQuantity: lossQty,
    defaultProcessingCost: procCost,
    notes,
  });

  await recipe.populate("inputProduct", "name unit currentStock purchaseCost");
  await recipe.populate(
    "expectedOutputs.product",
    "name unit currentStock sellingPrice"
  );
  return recipe;
};

/**
 * Execute an atomic product transformation (raw material -> finished goods + by-products + loss)
 * inside a MongoDB transaction with duplicate protection.
 */
export const executeTransformation = async (payload = {}) => {
  const {
    recipeId = null,
    inputProductId,
    inputQuantity,
    inputUnit,
    outputs,
    processingLoss = 0,
    lossUnit,
    processingCost = 0,
    idempotencyKey = null,
    batchReference = null,
    notes = null,
  } = payload;

  if (recipeId && !mongoose.isValidObjectId(recipeId)) {
    throw new InventoryError(400, "Invalid recipeId");
  }
  if (!inputProductId || !mongoose.isValidObjectId(inputProductId)) {
    throw new InventoryError(400, "Valid inputProductId is required");
  }
  if (!Array.isArray(outputs) || outputs.length === 0) {
    throw new InventoryError(400, "At least one transformation output is required");
  }

  const parsedInputQty = parsePositiveNumber(inputQuantity, "inputQuantity");
  const parsedLoss = parseNonNegativeNumber(processingLoss, "processingLoss");
  const parsedProcCost = parseNonNegativeNumber(
    processingCost,
    "processingCost"
  );

  const normalizedKey =
    typeof idempotencyKey === "string" && idempotencyKey.trim()
      ? idempotencyKey.trim()
      : null;

  const fingerprintPayload = {
    recipeId: recipeId || null,
    inputProductId,
    inputQuantity: parsedInputQty,
    inputUnit: inputUnit || null,
    outputs: outputs.map((o) => ({
      productId: o?.productId,
      role: o?.role || "finished_good",
      quantity: Number(o?.quantity),
      unit: o?.unit || null,
    })),
    processingLoss: parsedLoss,
    processingCost: parsedProcCost,
    batchReference: batchReference || null,
  };

  const requestFingerprint = crypto
    .createHash("sha256")
    .update(JSON.stringify(fingerprintPayload))
    .digest("hex");

  const lockKey = normalizedKey || requestFingerprint;
  if (inFlightTransformationKeys.has(lockKey)) {
    throw new InventoryError(
      409,
      "Duplicate transformation request is already in progress"
    );
  }

  inFlightTransformationKeys.add(lockKey);

  try {
    if (normalizedKey) {
      const existingByKey = await Transformation.findOne({
        idempotencyKey: normalizedKey,
      });
      if (existingByKey) {
        throw new InventoryError(
          409,
          "Duplicate transformation request (idempotencyKey already processed)",
          { transformation: existingByKey }
        );
      }
    }

    const recentWindowStart = new Date(Date.now() - 15000);
    const recentDuplicate = await Transformation.findOne({
      requestFingerprint,
      createdAt: { $gte: recentWindowStart },
    });
    if (recentDuplicate) {
      throw new InventoryError(
        409,
        "Duplicate transformation request detected within active window",
        { transformation: recentDuplicate }
      );
    }

    return await runInTransaction(async (session) => {
      const inputProduct = await Product.findById(inputProductId).session(session);
      if (!inputProduct) {
        throw new InventoryError(404, "Input raw material product not found");
      }

      const resolvedInputUnit = inputUnit
        ? validateUnit(inputUnit, "inputUnit")
        : inputProduct.unit;
      const inputQtyInProductUnit = roundQty(
        convertQuantity(parsedInputQty, resolvedInputUnit, inputProduct.unit)
      );

      if (inputProduct.currentStock < inputQtyInProductUnit) {
        throw new InventoryError(
          400,
          `Insufficient raw material "${inputProduct.name}". Available: ${inputProduct.currentStock} ${inputProduct.unit}, required: ${inputQtyInProductUnit} ${inputProduct.unit}`
        );
      }

      const resolvedLossUnit = lossUnit
        ? validateUnit(lossUnit, "lossUnit")
        : resolvedInputUnit;
      const lossInInputUnit = roundQty(
        convertQuantity(parsedLoss, resolvedLossUnit, resolvedInputUnit)
      );

      let totalOutputInInputUnit = 0;
      let primaryOutputInInputUnit = 0;
      const preparedOutputs = [];

      for (const out of outputs) {
        if (!out?.productId || !mongoose.isValidObjectId(out.productId)) {
          throw new InventoryError(400, "Valid output productId is required");
        }
        if (out.productId === inputProduct._id.toString()) {
          throw new InventoryError(
            400,
            "Output product cannot be the same as input raw material"
          );
        }

        const outProduct = await Product.findById(out.productId).session(session);
        if (!outProduct) {
          throw new InventoryError(
            404,
            `Output product ${out.productId} not found`
          );
        }

        const outQty = parsePositiveNumber(out.quantity, "output quantity");
        const outUnit = out.unit
          ? validateUnit(out.unit, "output unit")
          : outProduct.unit;
        const outQtyInOutProductUnit = roundQty(
          convertQuantity(outQty, outUnit, outProduct.unit)
        );
        const outQtyInInputUnit = roundQty(
          convertQuantity(outQty, outUnit, resolvedInputUnit)
        );

        const role =
          out.role === "by_product" || outProduct.productRole === "by_product"
            ? "by_product"
            : "finished_good";

        totalOutputInInputUnit += outQtyInInputUnit;
        if (role === "finished_good") {
          primaryOutputInInputUnit += outQtyInInputUnit;
        }

        const sellingPrice =
          out.unitSellingPrice !== undefined && out.unitSellingPrice !== null
            ? parseNonNegativeNumber(out.unitSellingPrice, "unitSellingPrice")
            : outProduct.sellingPrice;

        const estimatedValue =
          sellingPrice !== null
            ? roundMoney(outQtyInOutProductUnit * sellingPrice)
            : null;

        preparedOutputs.push({
          outProduct,
          role,
          outQtyInOutProductUnit,
          sellingPrice,
          estimatedValue,
        });
      }

      if (
        totalOutputInInputUnit + lossInInputUnit >
        parsedInputQty + 0.0001
      ) {
        throw new InventoryError(
          400,
          `Total outputs (${roundQty(totalOutputInInputUnit)} ${resolvedInputUnit}) plus processing loss (${lossInInputUnit} ${resolvedInputUnit}) cannot exceed input quantity (${parsedInputQty} ${resolvedInputUnit})`
        );
      }

      const rawUnitCost = inputProduct.purchaseCost;
      const costComplete = rawUnitCost !== null && rawUnitCost !== undefined;
      const totalRawMaterialCost = costComplete
        ? roundMoney(inputQtyInProductUnit * rawUnitCost)
        : null;
      const totalInputCost = costComplete
        ? roundMoney(totalRawMaterialCost + parsedProcCost)
        : null;
      const estimatedLossValue = costComplete
        ? roundMoney(
            convertQuantity(
              lossInInputUnit,
              resolvedInputUnit,
              inputProduct.unit
            ) * rawUnitCost
          )
        : null;

      const byProductEstimatedValue = roundMoney(
        preparedOutputs
          .filter((o) => o.role === "by_product" && o.estimatedValue !== null)
          .reduce((sum, o) => sum + o.estimatedValue, 0)
      );

      const totalFinishedQty = preparedOutputs
        .filter((o) => o.role === "finished_good")
        .reduce((sum, o) => sum + o.outQtyInOutProductUnit, 0);

      const netFinishedCostPool =
        totalInputCost !== null
          ? Math.max(0, roundMoney(totalInputCost - byProductEstimatedValue))
          : null;

      // 1. Deduct raw material stock
      const prevInputStock = inputProduct.currentStock;
      const newInputStock = roundQty(prevInputStock - inputQtyInProductUnit);
      inputProduct.currentStock = newInputStock;
      await inputProduct.save({ session });

      const transformationId = new mongoose.Types.ObjectId();

      await StockMovement.create(
        [
          {
            product: inputProduct._id,
            movementType: "transformation_input",
            quantityChange: -inputQtyInProductUnit,
            quantity: inputQtyInProductUnit,
            unit: inputProduct.unit,
            previousStock: prevInputStock,
            newStock: newInputStock,
            unitCost: rawUnitCost,
            totalCost: totalRawMaterialCost,
            transformation: transformationId,
            reason: "Product transformation input",
            note: notes,
            idempotencyKey: normalizedKey,
          },
        ],
        { session }
      );

      // 2. Add finished good & by-product stock + movements
      const outputSubdocs = [];
      for (const item of preparedOutputs) {
        const {
          outProduct,
          role,
          outQtyInOutProductUnit,
          sellingPrice,
          estimatedValue,
        } = item;

        let allocatedUnitCost = null;
        if (costComplete) {
          if (role === "by_product") {
            allocatedUnitCost = sellingPrice !== null ? sellingPrice : 0;
          } else if (totalFinishedQty > 0 && netFinishedCostPool !== null) {
            allocatedUnitCost = roundMoney(
              netFinishedCostPool / totalFinishedQty
            );
          }
        }

        const prevOutStock = outProduct.currentStock;
        const newOutStock = roundQty(prevOutStock + outQtyInOutProductUnit);

        if (allocatedUnitCost !== null && newOutStock > 0) {
          if (outProduct.purchaseCost !== null && prevOutStock > 0) {
            const prevVal = prevOutStock * outProduct.purchaseCost;
            const addedVal = outQtyInOutProductUnit * allocatedUnitCost;
            outProduct.purchaseCost = roundMoney(
              (prevVal + addedVal) / newOutStock
            );
          } else {
            outProduct.purchaseCost = allocatedUnitCost;
          }
        }

        outProduct.currentStock = newOutStock;
        await outProduct.save({ session });

        await StockMovement.create(
          [
            {
              product: outProduct._id,
              movementType:
                role === "by_product"
                  ? "transformation_byproduct"
                  : "transformation_output",
              quantityChange: outQtyInOutProductUnit,
              quantity: outQtyInOutProductUnit,
              unit: outProduct.unit,
              previousStock: prevOutStock,
              newStock: newOutStock,
              unitCost: allocatedUnitCost,
              totalCost:
                allocatedUnitCost !== null
                  ? roundMoney(outQtyInOutProductUnit * allocatedUnitCost)
                  : null,
              transformation: transformationId,
              reason:
                role === "by_product"
                  ? "Transformation by-product"
                  : "Transformation finished output",
              note: notes,
            },
          ],
          { session }
        );

        outputSubdocs.push({
          product: outProduct._id,
          productName: outProduct.name,
          role,
          quantity: outQtyInOutProductUnit,
          unit: outProduct.unit,
          unitSellingPrice: sellingPrice,
          allocatedUnitCost,
          estimatedValue,
        });
      }

      const yieldPercentage = roundMoney(
        (primaryOutputInInputUnit / parsedInputQty) * 100
      );
      const totalRecoveryPercentage = roundMoney(
        (totalOutputInInputUnit / parsedInputQty) * 100
      );

      const [transformation] = await Transformation.create(
        [
          {
            _id: transformationId,
            recipe: recipeId || null,
            idempotencyKey: normalizedKey,
            requestFingerprint,
            input: {
              product: inputProduct._id,
              productName: inputProduct.name,
              quantity: inputQtyInProductUnit,
              unit: inputProduct.unit,
              unitCost: rawUnitCost,
              totalRawMaterialCost,
            },
            outputs: outputSubdocs,
            processingLoss: roundQty(lossInInputUnit),
            lossUnit: resolvedInputUnit,
            totalOutputQuantity: roundQty(totalOutputInInputUnit),
            primaryOutputQuantity: roundQty(primaryOutputInInputUnit),
            yieldPercentage,
            totalRecoveryPercentage,
            processingCost: parsedProcCost,
            totalInputCost,
            byProductEstimatedValue,
            estimatedLossValue,
            costComplete,
            batchReference,
            notes,
          },
        ],
        { session }
      );

      return transformation;
    });
  } finally {
    inFlightTransformationKeys.delete(lockKey);
  }
};

/**
 * Compute Product-wise gross profit, Customer-wise revenue, Transformation costs/losses,
 * and clearly separate Estimated Profit from Actual Realized Profit.
 */
export const getProfitAndLossReport = async ({
  startDate,
  endDate,
  productId,
  customerId,
} = {}) => {
  const dateFilter = {};
  if (startDate) dateFilter.$gte = new Date(startDate);
  if (endDate) dateFilter.$lte = new Date(endDate);

  const saleFilter = { movementType: "sale" };
  if (Object.keys(dateFilter).length > 0) saleFilter.createdAt = dateFilter;
  if (productId) {
    if (!mongoose.isValidObjectId(productId)) {
      throw new InventoryError(400, "Invalid productId");
    }
    saleFilter.product = productId;
  }
  if (customerId) {
    if (!mongoose.isValidObjectId(customerId)) {
      throw new InventoryError(400, "Invalid customerId");
    }
    saleFilter.customer = customerId;
  }

  const txFilter = {};
  if (Object.keys(dateFilter).length > 0) txFilter.createdAt = dateFilter;
  if (productId) {
    txFilter.$or = [
      { "input.product": productId },
      { "outputs.product": productId },
    ];
  }

  const [sales, transformations] = await Promise.all([
    StockMovement.find(saleFilter)
      .populate("product", "name unit category sellingPrice purchaseCost")
      .populate("customer", "name phone"),
    Transformation.find(txFilter),
  ]);

  let actualRealizedRevenue = 0;
  let knownRealizedCogs = 0;
  let revenueWithCompleteCost = 0;
  let hasMissingCostData = false;
  const productsMissingCostSet = new Set();

  const productMap = new Map();
  const customerMap = new Map();

  for (const sale of sales) {
    const rev = sale.totalRevenue || 0;
    actualRealizedRevenue += rev;

    const prodId = sale.product?._id?.toString() || sale.product?.toString();
    const prodName = sale.product?.name || "Unknown Product";
    const prodMissingCost = sale.totalCost === null || sale.totalCost === undefined;

    if (prodMissingCost) {
      hasMissingCostData = true;
      productsMissingCostSet.add(prodName);
    } else {
      knownRealizedCogs += sale.totalCost;
      revenueWithCompleteCost += rev;
    }

    if (!productMap.has(prodId)) {
      productMap.set(prodId, {
        productId: prodId,
        productName: prodName,
        unit: sale.unit,
        quantitySold: 0,
        revenue: 0,
        knownCogs: 0,
        costDataMissing: false,
        grossProfit: 0,
      });
    }
    const pEntry = productMap.get(prodId);
    pEntry.quantitySold = roundQty(pEntry.quantitySold + sale.quantity);
    pEntry.revenue = roundMoney(pEntry.revenue + rev);
    if (prodMissingCost) {
      pEntry.costDataMissing = true;
      pEntry.grossProfit = null;
    } else {
      pEntry.knownCogs = roundMoney(pEntry.knownCogs + sale.totalCost);
      if (!pEntry.costDataMissing) {
        pEntry.grossProfit = roundMoney(pEntry.revenue - pEntry.knownCogs);
      }
    }

    const custId = sale.customer?._id?.toString() || "walk_in";
    const custName = sale.customer?.name || "Walk-in / Unspecified";
    if (!customerMap.has(custId)) {
      customerMap.set(custId, {
        customerId: sale.customer?._id?.toString() || null,
        customerName: custName,
        salesCount: 0,
        totalQuantitySold: 0,
        revenue: 0,
        knownCogs: 0,
        costDataMissing: false,
        grossProfit: 0,
      });
    }
    const cEntry = customerMap.get(custId);
    cEntry.salesCount += 1;
    cEntry.totalQuantitySold = roundQty(cEntry.totalQuantitySold + sale.quantity);
    cEntry.revenue = roundMoney(cEntry.revenue + rev);
    if (prodMissingCost) {
      cEntry.costDataMissing = true;
      cEntry.grossProfit = null;
    } else {
      cEntry.knownCogs = roundMoney(cEntry.knownCogs + sale.totalCost);
      if (!cEntry.costDataMissing) {
        cEntry.grossProfit = roundMoney(cEntry.revenue - cEntry.knownCogs);
      }
    }
  }

  let totalRawMaterialCost = 0;
  let totalProcessingCost = 0;
  let totalByProductEstimatedValue = 0;
  let totalEstimatedProcessingLossValue = 0;
  let estimatedFinishedOutputValue = 0;
  let transformationCostMissing = false;
  let transformationSellingPriceMissing = false;

  for (const tx of transformations) {
    if (tx.costComplete && tx.input?.totalRawMaterialCost !== null) {
      totalRawMaterialCost += tx.input.totalRawMaterialCost;
    } else {
      transformationCostMissing = true;
    }
    totalProcessingCost += tx.processingCost || 0;
    totalByProductEstimatedValue += tx.byProductEstimatedValue || 0;
    if (tx.estimatedLossValue !== null && tx.estimatedLossValue !== undefined) {
      totalEstimatedProcessingLossValue += tx.estimatedLossValue;
    }

    for (const out of tx.outputs) {
      if (out.role === "finished_good") {
        if (out.estimatedValue !== null && out.estimatedValue !== undefined) {
          estimatedFinishedOutputValue += out.estimatedValue;
        } else {
          transformationSellingPriceMissing = true;
        }
      }
    }
  }

  const totalEstimatedOutputValue = roundMoney(
    estimatedFinishedOutputValue + totalByProductEstimatedValue
  );
  const totalKnownTransformationInputCost = roundMoney(
    totalRawMaterialCost + totalProcessingCost
  );

  const estimatedTransformationProfit =
    !transformationCostMissing && !transformationSellingPriceMissing && transformations.length > 0
      ? roundMoney(totalEstimatedOutputValue - totalKnownTransformationInputCost)
      : null;

  return {
    actualRealized: {
      exactProfitAvailable: !hasMissingCostData,
      status: hasMissingCostData ? "incomplete_cost_data" : "exact",
      totalSalesCount: sales.length,
      totalRevenue: roundMoney(actualRealizedRevenue),
      knownCostOfGoodsSold: roundMoney(knownRealizedCogs),
      actualProfit: hasMissingCostData
        ? null
        : roundMoney(actualRealizedRevenue - knownRealizedCogs),
      partialMarginOnCostedSales: roundMoney(
        revenueWithCompleteCost - knownRealizedCogs
      ),
      productsWithMissingCost: Array.from(productsMissingCostSet),
    },
    estimatedFromTransformations: {
      transformationCount: transformations.length,
      costDataComplete: !transformationCostMissing,
      sellingPriceDataComplete: !transformationSellingPriceMissing,
      rawMaterialCost: transformationCostMissing
        ? null
        : roundMoney(totalRawMaterialCost),
      knownRawMaterialCost: roundMoney(totalRawMaterialCost),
      processingCost: roundMoney(totalProcessingCost),
      byProductValue: roundMoney(totalByProductEstimatedValue),
      estimatedProcessingLoss: transformationCostMissing
        ? null
        : roundMoney(totalEstimatedProcessingLossValue),
      estimatedOutputPotentialRevenue: totalEstimatedOutputValue,
      estimatedProfit: estimatedTransformationProfit,
    },
    productWiseGrossProfit: Array.from(productMap.values()),
    customerWiseRevenue: Array.from(customerMap.values()),
  };
};
