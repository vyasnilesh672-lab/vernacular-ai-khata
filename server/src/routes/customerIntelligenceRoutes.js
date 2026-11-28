import express from "express";
import {
  CustomerIntelligenceError,
  buildCustomerIntelligence,
  getCustomerPaymentHistory,
  listCustomersIntelligence,
} from "../services/customerIntelligenceService.js";
import { translateCustomerInsights } from "../services/geminiService.js";

const router = express.Router();

const handleError = (res, error) => {
  if (error instanceof CustomerIntelligenceError) {
    return res.status(error.status).json({
      success: false,
      message: error.message,
    });
  }
  return res.status(500).json({
    success: false,
    message: error.message || "Customer intelligence request failed",
  });
};

// Customers with overdue balances (paginated + date-filterable)
router.get("/intelligence/overdue", async (req, res) => {
  try {
    const result = await listCustomersIntelligence({
      filterType: "overdue",
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      page: req.query.page,
      limit: req.query.limit,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    handleError(res, error);
  }
});

// Customers with highest outstanding balances (paginated + date-filterable)
router.get("/intelligence/highest-outstanding", async (req, res) => {
  try {
    const result = await listCustomersIntelligence({
      filterType: "highest_outstanding",
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      page: req.query.page,
      limit: req.query.limit,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    handleError(res, error);
  }
});

// Customers with improving or worsening payment patterns (paginated + date-filterable)
router.get("/intelligence/patterns", async (req, res) => {
  try {
    const allowedTrends = new Set([
      "improving",
      "worsening",
      "stable",
      "insufficient_history",
    ]);
    const trend =
      typeof req.query.trend === "string" && allowedTrends.has(req.query.trend)
        ? req.query.trend
        : undefined;

    const result = await listCustomersIntelligence({
      filterType: "patterns",
      trend,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      page: req.query.page,
      limit: req.query.limit,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    handleError(res, error);
  }
});

// Customer financial summary & actionable insights
router.get("/:id/summary", async (req, res) => {
  try {
    const intel = await buildCustomerIntelligence(req.params.id, {
      startDate: req.query.startDate,
      endDate: req.query.endDate,
    });

    const explainIn =
      typeof req.query.explainIn === "string" ? req.query.explainIn.trim() : "";
    let localizedInsights = null;
    if (["Gujarati", "Hindi", "Hinglish"].includes(explainIn)) {
      localizedInsights = await translateCustomerInsights(intel.insights, {
        customerName: intel.customer.name,
        targetLanguage: explainIn,
      });
    }

    res.json({
      success: true,
      data: {
        customer: intel.customer,
        dateRange: intel.dateRange,
        financialProfile: intel.financialProfile,
        pattern: intel.pattern,
        insights: intel.insights,
        ...(localizedInsights ? { localizedInsights, explainIn } : {}),
      },
    });
  } catch (error) {
    handleError(res, error);
  }
});

// Customer payment, promise, and purchase history (paginated + date-filterable)
router.get("/:id/history", async (req, res) => {
  try {
    const result = await getCustomerPaymentHistory(req.params.id, {
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      entryKind: req.query.entryKind,
      page: req.query.page,
      limit: req.query.limit,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    handleError(res, error);
  }
});

// Customer explainable Udhaar risk assessment
router.get("/:id/risk", async (req, res) => {
  try {
    const intel = await buildCustomerIntelligence(req.params.id, {
      startDate: req.query.startDate,
      endDate: req.query.endDate,
    });
    res.json({
      success: true,
      data: {
        customer: intel.customer,
        dateRange: intel.dateRange,
        pattern: intel.pattern,
        riskAssessment: intel.riskAssessment,
        insights: intel.insights,
      },
    });
  } catch (error) {
    handleError(res, error);
  }
});

export default router;
