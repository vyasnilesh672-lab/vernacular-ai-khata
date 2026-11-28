import express from "express";
import {
  getWhatsAppAdapterStatus,
  verifyWebhookChallenge,
  verifyWebhookSignature,
} from "../services/whatsappService.js";
import {
  processIncomingCustomerReply,
  updateReminderDeliveryStatus,
} from "../services/reminderService.js";

const router = express.Router();

// Safe configuration status endpoint (never exposes secrets)
router.get("/status", (req, res) => {
  res.json({
    success: true,
    data: getWhatsAppAdapterStatus(),
  });
});

// Meta WhatsApp Business Cloud API webhook verification challenge
router.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  const check = verifyWebhookChallenge(mode, token);
  if (!check.ok) {
    return res.status(check.status).json({
      success: false,
      message: check.reason,
    });
  }

  return res.status(200).send(typeof challenge === "string" ? challenge : "");
});

// Meta WhatsApp Business Cloud API incoming message & delivery status webhook
router.post("/webhook", async (req, res) => {
  try {
    const signatureHeader = req.get("x-hub-signature-256");
    const sigCheck = verifyWebhookSignature(req.rawBody, signatureHeader);

    if (!sigCheck.valid) {
      return res.status(401).json({
        success: false,
        message: "Invalid WhatsApp webhook signature",
      });
    }

    const adapterStatus = getWhatsAppAdapterStatus();
    const channel = adapterStatus.configured ? "whatsapp_cloud" : "mock";

    const entries = Array.isArray(req.body?.entry) ? req.body.entry : [];
    const processedMessages = [];
    const duplicateMessages = [];
    const updatedStatuses = [];

    for (const entry of entries) {
      const changes = Array.isArray(entry?.changes) ? entry.changes : [];
      for (const change of changes) {
        const value = change?.value;
        if (!value || typeof value !== "object") continue;

        const statuses = Array.isArray(value.statuses) ? value.statuses : [];
        for (const st of statuses) {
          const updated = await updateReminderDeliveryStatus({
            providerMessageId: st?.id,
            deliveryStatus: st?.status,
            detail: st?.errors?.[0]?.title || null,
          });
          if (updated) {
            updatedStatuses.push({
              reminderId: updated._id,
              providerMessageId: updated.providerMessageId,
              deliveryStatus: updated.deliveryStatus,
            });
          }
        }

        const messages = Array.isArray(value.messages) ? value.messages : [];
        for (const msg of messages) {
          const textBody =
            msg?.text?.body ||
            msg?.button?.text ||
            msg?.interactive?.button_reply?.title ||
            msg?.interactive?.list_reply?.title ||
            "";

          if (!textBody.trim()) continue;

          const result = await processIncomingCustomerReply({
            fromPhone: msg?.from || "",
            message: textBody,
            messageId: msg?.id || null,
            channel,
          });

          if (result.duplicate) {
            duplicateMessages.push({
              messageId: msg?.id || null,
              from: msg?.from || null,
            });
          } else if (result.success) {
            processedMessages.push(result.data);
          }
        }
      }
    }

    return res.status(200).json({
      success: true,
      mode: adapterStatus.mode,
      signatureVerified: sigCheck.enforced ? sigCheck.valid : null,
      processedCount: processedMessages.length,
      duplicateCount: duplicateMessages.length,
      statusUpdateCount: updatedStatuses.length,
      data: {
        processedMessages,
        duplicateMessages,
        updatedStatuses,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

export default router;
