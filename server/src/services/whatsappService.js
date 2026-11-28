import crypto from "node:crypto";

const getWhatsAppConfig = () => {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim() || "";
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() || "";
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN?.trim() || "";
  const appSecret = process.env.WHATSAPP_APP_SECRET?.trim() || "";
  const apiVersion = process.env.WHATSAPP_API_VERSION?.trim() || "v21.0";

  const configured = Boolean(accessToken && phoneNumberId);

  return {
    accessToken,
    phoneNumberId,
    verifyToken,
    appSecret,
    apiVersion,
    configured,
  };
};

/**
 * Normalize Indian/international phone numbers to digits for WhatsApp Cloud API.
 */
export const normalizePhoneForWhatsApp = (phone) => {
  if (typeof phone !== "string") return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) {
    return `91${digits}`;
  }
  return digits;
};

/**
 * Return public-safe WhatsApp adapter status without exposing credentials.
 */
export const getWhatsAppAdapterStatus = () => {
  const cfg = getWhatsAppConfig();
  return {
    configured: cfg.configured,
    mode: cfg.configured ? "whatsapp_cloud" : "mock",
    apiVersion: cfg.apiVersion,
    hasVerifyToken: Boolean(cfg.verifyToken),
    hasAppSecret: Boolean(cfg.appSecret),
  };
};

/**
 * Verify Meta webhook subscription challenge token using timing-safe comparison.
 */
export const verifyWebhookChallenge = (mode, token) => {
  const { verifyToken } = getWhatsAppConfig();
  if (!verifyToken) {
    return { ok: false, status: 503, reason: "WHATSAPP_VERIFY_TOKEN is not configured" };
  }
  if (mode !== "subscribe" || typeof token !== "string") {
    return { ok: false, status: 403, reason: "Invalid webhook verification parameters" };
  }

  const expectedBuf = Buffer.from(verifyToken, "utf8");
  const providedBuf = Buffer.from(token, "utf8");
  if (
    expectedBuf.length !== providedBuf.length ||
    !crypto.timingSafeEqual(expectedBuf, providedBuf)
  ) {
    return { ok: false, status: 403, reason: "Verify token mismatch" };
  }

  return { ok: true, status: 200 };
};

/**
 * Verify Meta X-Hub-Signature-256 HMAC header against raw request bytes.
 */
export const verifyWebhookSignature = (rawBody, signatureHeader) => {
  const { appSecret } = getWhatsAppConfig();
  if (!appSecret) {
    return { enforced: false, valid: true };
  }

  if (
    typeof signatureHeader !== "string" ||
    !signatureHeader.startsWith("sha256=") ||
    !rawBody
  ) {
    return { enforced: true, valid: false };
  }

  const expectedHex = crypto
    .createHmac("sha256", appSecret)
    .update(rawBody)
    .digest("hex");
  const providedHex = signatureHeader.slice("sha256=".length);

  const expectedBuf = Buffer.from(expectedHex, "utf8");
  const providedBuf = Buffer.from(providedHex, "utf8");

  const valid =
    expectedBuf.length === providedBuf.length &&
    crypto.timingSafeEqual(expectedBuf, providedBuf);

  return { enforced: true, valid };
};

/**
 * Send a WhatsApp text message via Cloud API when credentials are present,
 * or via a clearly labelled mock adapter when credentials are absent.
 */
export const sendWhatsAppTextMessage = async ({ toPhone, text }) => {
  const cfg = getWhatsAppConfig();
  const recipient = normalizePhoneForWhatsApp(toPhone);

  if (!recipient) {
    return {
      success: false,
      channel: cfg.configured ? "whatsapp_cloud" : "mock",
      isMock: !cfg.configured,
      deliveryStatus: "failed",
      providerMessageId: null,
      error: "Valid customer phone number is required",
    };
  }

  if (!cfg.configured) {
    const mockId = `mock_wamid_${crypto.randomUUID()}`;
    console.log(
      `[WhatsApp Mock Adapter] Simulated send to ${recipient} (id=${mockId}): ${text}`
    );
    return {
      success: true,
      channel: "mock",
      isMock: true,
      deliveryStatus: "mock_sent",
      providerMessageId: mockId,
      error: null,
    };
  }

  try {
    const url = `https://graph.facebook.com/${cfg.apiVersion}/${cfg.phoneNumberId}/messages`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: recipient,
        type: "text",
        text: {
          preview_url: false,
          body: text,
        },
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const apiError =
        data?.error?.message || `WhatsApp API error (${response.status})`;
      return {
        success: false,
        channel: "whatsapp_cloud",
        isMock: false,
        deliveryStatus: "failed",
        providerMessageId: null,
        error: apiError,
      };
    }

    const messageId = data?.messages?.[0]?.id || null;

    return {
      success: true,
      channel: "whatsapp_cloud",
      isMock: false,
      deliveryStatus: "sent",
      providerMessageId: messageId,
      error: null,
    };
  } catch (err) {
    return {
      success: false,
      channel: "whatsapp_cloud",
      isMock: false,
      deliveryStatus: "failed",
      providerMessageId: null,
      error: err.message || "Network error calling WhatsApp Cloud API",
    };
  }
};
