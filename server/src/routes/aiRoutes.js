
import express from "express";
import Customer from "../models/Customer.js";
import { extractPaymentDetails } from "../services/geminiService.js";

const router = express.Router();

// Extract payment details using Gemini AI
router.post("/extract", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({
        success: false,
        message: "Customer message is required",
      });
    }

    const customers = await Customer.find();

    const extractedData = await extractPaymentDetails(
      message.trim(),
      customers
    );

    res.json({
      success: true,
      message: "Payment details extracted successfully",
      data: extractedData,
    });
  } catch (error) {
    console.error("AI extraction error:", error.message);

    res.status(500).json({
      success: false,
      message: "Unable to extract payment details",
    });
  }
});

export default router;
