
import express from "express";
import mongoose from "mongoose";
import Commitment from "../models/Commitment.js";
import Customer from "../models/Customer.js";

const router = express.Router();

// Create a payment commitment
router.post("/", async (req, res) => {
  try {
    const {
      customerId,
      amount,
      promisedDate,
      originalMessage,
    } = req.body;

    if (!customerId || !mongoose.isValidObjectId(customerId)) {
      return res.status(400).json({
        success: false,
        message: "Valid customer ID is required",
      });
    }

    if (!amount || Number(amount) <= 0 || !Number.isFinite(Number(amount))) {
      return res.status(400).json({
        success: false,
        message: "Valid amount is required",
      });
    }

    if (!promisedDate || Number.isNaN(Date.parse(promisedDate))) {
      return res.status(400).json({
        success: false,
        message: "Valid promised date is required",
      });
    }

    if (!originalMessage?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Original message is required",
      });
    }

    const customer = await Customer.findById(customerId);

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    const commitment = await Commitment.create({
      customer: customerId,
      amount: Number(amount),
      promisedDate: new Date(promisedDate),
      originalMessage,
    });

    const populatedCommitment = await commitment.populate("customer");

    res.status(201).json({
      success: true,
      message: "Payment commitment created successfully",
      data: populatedCommitment,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Get all payment commitments
router.get("/", async (req, res) => {
  try {
    const commitments = await Commitment.find()
      .populate("customer", "name phone preferredLanguage")
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

    if (commitment.paymentStatus === "Paid") {
      return res.status(400).json({
        success: false,
        message: "Payment is already marked as received",
      });
    }

    commitment.paymentStatus = "Paid";
    commitment.paidAt = new Date();

    await commitment.save();

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
    const { status } = req.body;

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

    commitment.status = status;
    await commitment.save();

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