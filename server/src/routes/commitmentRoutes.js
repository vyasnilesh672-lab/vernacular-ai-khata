
import express from "express";
import mongoose from "mongoose";
import Commitment from "../models/Commitment.js";
import {
  CUSTOMER_PROJECTION,
  CommitmentError,
  createConfirmedCommitment,
} from "../services/commitmentService.js";

const router = express.Router();

// Create a payment commitment or payment received record
router.post("/", async (req, res) => {
  try {
    const { commitment, isPaymentReceived } = await createConfirmedCommitment(
      req.body || {}
    );

    return res.status(201).json({
      success: true,
      message: isPaymentReceived
        ? "Payment received recorded successfully"
        : "Payment commitment created successfully",
      data: commitment,
    });
  } catch (error) {
    if (error instanceof CommitmentError) {
      return res.status(error.status).json({
        success: false,
        message: error.message,
      });
    }
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Get all confirmed payment commitments
router.get("/", async (req, res) => {
  try {
    const commitments = await Commitment.find({ confirmedByVendor: true })
      .populate("customer", CUSTOMER_PROJECTION)
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: commitments.length,
      data: commitments,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

router.patch("/:id/payment", async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid commitment ID",
      });
    }

    const commitment = await Commitment.findById(id);

    if (!commitment) {
      return res.status(404).json({
        success: false,
        message: "Commitment not found",
      });
    }

    if (commitment.confirmedByVendor !== true) {
      return res.status(400).json({
        success: false,
        message: "Commitment must be confirmed by vendor before recording payment",
      });
    }

    if (commitment.paymentStatus === "Paid") {
      return res.status(400).json({
        success: false,
        message: "Payment is already marked as received",
      });
    }

    const prevStatus = commitment.status;
    if (!commitment.originalAmount) {
      commitment.originalAmount = commitment.amount;
    }
    commitment.paidAmount = commitment.originalAmount;
    commitment.paymentStatus = "Paid";
    commitment.paidAt = new Date();
    if (commitment.status === "Pending" || commitment.status === "Renegotiated") {
      commitment.status = "Kept";
    }
    commitment.history.push({
      action: "payment_marked_received",
      previousAmount: commitment.amount,
      newAmount: commitment.amount,
      previousPromisedDate: commitment.promisedDate,
      newPromisedDate: commitment.promisedDate,
      previousStatus: prevStatus,
      newStatus: commitment.status,
      note: "Payment marked as received by vendor",
      actor: "vendor",
    });

    await commitment.save();
    await commitment.populate("customer", CUSTOMER_PROJECTION);

    res.json({
      success: true,
      message: "Payment verified by vendor",
      data: commitment,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});


// Vendor confirms the extracted commitment
router.patch("/:id/confirm", async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid commitment ID",
      });
    }

    const commitment = await Commitment.findById(id);

    if (!commitment) {
      return res.status(404).json({
        success: false,
        message: "Commitment not found",
      });
    }

    commitment.confirmedByVendor = true;
    await commitment.save();
    await commitment.populate("customer", CUSTOMER_PROJECTION);

    res.json({
      success: true,
      message: "Commitment confirmed by vendor",
      data: commitment,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});
// Update promise tracking status
router.patch("/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};

    const allowedStatuses = [
      "Pending",
      "Kept",
      "Broken",
      "Renegotiated",
    ];

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid commitment ID",
      });
    }

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid commitment status",
      });
    }

    const commitment = await Commitment.findById(id);

    if (!commitment) {
      return res.status(404).json({
        success: false,
        message: "Commitment not found",
      });
    }

    if (commitment.confirmedByVendor !== true) {
      return res.status(400).json({
        success: false,
        message: "Commitment must be confirmed by vendor before updating status",
      });
    }

    if (commitment.paymentStatus === "Paid" && status === "Pending") {
      return res.status(400).json({
        success: false,
        message: "Paid commitment cannot be set back to Pending",
      });
    }

    const prevStatus = commitment.status;
    commitment.status = status;
    commitment.history.push({
      action: "status_updated",
      previousAmount: commitment.amount,
      newAmount: commitment.amount,
      previousPromisedDate: commitment.promisedDate,
      newPromisedDate: commitment.promisedDate,
      previousStatus: prevStatus,
      newStatus: status,
      note: `Status changed from ${prevStatus} to ${status}`,
      actor: "vendor",
    });
    await commitment.save();
    await commitment.populate("customer", CUSTOMER_PROJECTION);

    res.json({
      success: true,
      message: "Promise status updated successfully",
      data: commitment,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

export default router;