import express from "express";
import {
  CommandOrchestratorError,
  confirmCommandSession,
  getCommandSessionStatus,
  handleUnifiedCommandMessage,
  listRecentCommandSessions,
  rejectCommandSession,
} from "../services/commandOrchestratorService.js";

const router = express.Router();

const handleError = (res, error) => {
  if (error instanceof CommandOrchestratorError) {
    return res.status(error.status).json({
      success: false,
      message: error.message,
      ...error.extra,
    });
  }
  return res.status(500).json({
    success: false,
    message: error.message || "Unified command processing failed",
  });
};

// List recent conversational command activity
router.get("/", async (req, res) => {
  try {
    const sessions = await listRecentCommandSessions({
      limit: req.query.limit,
      category: req.query.category,
    });
    res.json({
      success: true,
      count: sessions.length,
      data: sessions,
    });
  } catch (error) {
    handleError(res, error);
  }
});

// Interpret or continue a conversational business command (returns preview or read-only query result)
router.post("/", async (req, res) => {
  try {
    const { message, sessionId, confirmationToken, overrides } = req.body || {};
    const result = await handleUnifiedCommandMessage({
      message,
      sessionId,
      confirmationToken,
      overrides,
    });
    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    handleError(res, error);
  }
});

// Explicitly confirm a pending command preview using its single-use confirmationToken
router.post("/:sessionId/confirm", async (req, res) => {
  try {
    const { confirmationToken, idempotencyKey } = req.body || {};
    const result = await confirmCommandSession({
      sessionId: req.params.sessionId,
      confirmationToken,
      idempotencyKey,
    });
    res.json({
      success: true,
      message: "Command confirmed and executed",
      data: result,
    });
  } catch (error) {
    handleError(res, error);
  }
});

// Reject/cancel a pending command preview without mutating MongoDB
router.post("/:sessionId/reject", async (req, res) => {
  try {
    const result = await rejectCommandSession({
      sessionId: req.params.sessionId,
      reason: req.body?.reason,
    });
    res.json({
      success: true,
      message: "Command rejected without changes",
      data: result,
    });
  } catch (error) {
    handleError(res, error);
  }
});

// Inspect command session turns and audit trail
router.get("/:sessionId", async (req, res) => {
  try {
    const result = await getCommandSessionStatus(req.params.sessionId);
    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    handleError(res, error);
  }
});

export default router;
