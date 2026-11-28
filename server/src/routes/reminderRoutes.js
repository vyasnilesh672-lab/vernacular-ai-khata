import express from "express";
import mongoose from "mongoose";
import Reminder from "../models/Reminder.js";
import CustomerReply from "../models/CustomerReply.js";
import {
  confirmCustomerReplyAction,
  findReminderCandidates,
  processIncomingCustomerReply,
  sendReminderForCommitment,
} from "../services/reminderService.js";

const router = express.Router();

// Preview upcoming, due-today, and overdue commitments eligible for reminders
router.get("/candidates", async (req, res) => {
  try {
    const rawDays = Number(req.query.upcomingDays);
    const upcomingDays =
      Number.isFinite(rawDays) && rawDays >= 0 && rawDays <= 30 ? rawDays : 3;
    const language =
      typeof req.query.language === "string" ? req.query.language : undefined;

    const candidates = await findReminderCandidates({ upcomingDays, language });

    res.json({
      success: true,
      count: candidates.length,
      data: candidates,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// List reminder history & delivery status
router.get("/", async (req, res) => {
  try {
    const filter = {};
    if (req.query.commitmentId && mongoose.isValidObjectId(req.query.commitmentId)) {
      filter.commitment = req.query.commitmentId;
    }
    if (req.query.customerId && mongoose.isValidObjectId(req.query.customerId)) {
      filter.customer = req.query.customerId;
    }
    if (typeof req.query.deliveryStatus === "string") {
      filter.deliveryStatus = req.query.deliveryStatus;
    }
    if (typeof req.query.reminderType === "string") {
      filter.reminderType = req.query.reminderType;
    }

    const reminders = await Reminder.find(filter)
      .populate("customer", "name phone preferredLanguage")
      .populate("commitment", "amount originalAmount promisedDate status paymentStatus")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: reminders.length,
      data: reminders,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Send a single payment reminder (duplicate-safe per commitment per day)
router.post("/send", async (req, res) => {
  try {
    const { commitmentId, language, upcomingDays } = req.body || {};

    if (!commitmentId || !mongoose.isValidObjectId(commitmentId)) {
      return res.status(400).json({
        success: false,
        message: "Valid commitmentId is required",
      });
    }

    const result = await sendReminderForCommitment({
      commitmentId,
      language,
      upcomingDays: Number.isFinite(Number(upcomingDays)) ? Number(upcomingDays) : 3,
    });

    return res.status(result.status).json({
      success: result.success,
      duplicate: Boolean(result.duplicate),
      message: result.message,
      data: result.data || null,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Batch send reminders for all due/upcoming/overdue candidates not yet sent today
router.post("/send-due", async (req, res) => {
  try {
    const { upcomingDays = 3, language } = req.body || {};
    const candidates = await findReminderCandidates({
      upcomingDays: Number.isFinite(Number(upcomingDays)) ? Number(upcomingDays) : 3,
      language,
    });

    const sent = [];
    const skippedDuplicates = [];
    const failed = [];

    for (const candidate of candidates) {
      if (candidate.alreadySentToday) {
        skippedDuplicates.push({
          commitmentId: candidate.commitmentId,
          reason: "Already sent today",
        });
        continue;
      }

      const result = await sendReminderForCommitment({
        commitmentId: candidate.commitmentId,
        language,
        upcomingDays: Number.isFinite(Number(upcomingDays)) ? Number(upcomingDays) : 3,
      });

      if (result.success) {
        sent.push(result.data);
      } else if (result.duplicate) {
        skippedDuplicates.push({
          commitmentId: candidate.commitmentId,
          reason: result.message,
        });
      } else {
        failed.push({
          commitmentId: candidate.commitmentId,
          reason: result.message,
        });
      }
    }

    res.json({
      success: true,
      summary: {
        candidatesFound: candidates.length,
        sentCount: sent.length,
        skippedDuplicateCount: skippedDuplicates.length,
        failedCount: failed.length,
      },
      data: { sent, skippedDuplicates, failed },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// List customer replies and AI interpretations
router.get("/replies", async (req, res) => {
  try {
    const filter = {};
    if (typeof req.query.confirmationStatus === "string") {
      filter.confirmationStatus = req.query.confirmationStatus;
    }
    if (req.query.commitmentId && mongoose.isValidObjectId(req.query.commitmentId)) {
      filter.commitment = req.query.commitmentId;
    }

    const replies = await CustomerReply.find(filter)
      .populate("customer", "name phone preferredLanguage")
      .populate("commitment", "amount originalAmount paidAmount promisedDate status paymentStatus")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: replies.length,
      data: replies,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Interpret an incoming or manual customer reply (never mutates commitment directly)
router.post("/replies/interpret", async (req, res) => {
  try {
    const {
      fromPhone,
      message,
      messageId,
      customerId,
      commitmentId,
      channel = "manual",
    } = req.body || {};

    if (customerId && !mongoose.isValidObjectId(customerId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid customerId",
      });
    }
    if (commitmentId && !mongoose.isValidObjectId(commitmentId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid commitmentId",
      });
    }

    const result = await processIncomingCustomerReply({
      fromPhone,
      message,
      messageId,
      customerId,
      commitmentId,
      channel,
    });

    return res.status(result.status).json({
      success: result.success,
      duplicate: Boolean(result.duplicate),
      message: result.message,
      data: result.data || null,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Vendor explicitly confirms an interpreted customer reply before updating commitments
router.post("/replies/:id/confirm", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid reply ID",
      });
    }

    const { action, amount, promisedDate, vendorNote } = req.body || {};

    const result = await confirmCustomerReplyAction({
      replyId: id,
      action,
      amount,
      promisedDate,
      vendorNote,
    });

    return res.status(result.status).json({
      success: result.success,
      message: result.message,
      data: result.data || null,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Vendor rejects or dismisses an AI reply interpretation without changing commitments
router.post("/replies/:id/reject", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid reply ID",
      });
    }

    const reply = await CustomerReply.findById(id);
    if (!reply) {
      return res.status(404).json({
        success: false,
        message: "Customer reply not found",
      });
    }

    if (reply.confirmationStatus === "confirmed") {
      return res.status(409).json({
        success: false,
        message: "Confirmed reply cannot be rejected",
      });
    }

    reply.confirmationStatus = "rejected";
    reply.vendorNote = req.body?.vendorNote || "Rejected by vendor";
    await reply.save();

    res.json({
      success: true,
      message: "Customer reply dismissed without modifying commitment",
      data: reply,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

export default router;
