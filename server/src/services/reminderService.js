import crypto from "node:crypto";
import Commitment from "../models/Commitment.js";
import Customer from "../models/Customer.js";
import Reminder from "../models/Reminder.js";
import CustomerReply from "../models/CustomerReply.js";
import { interpretCustomerReply } from "./geminiService.js";
import {
  normalizePhoneForWhatsApp,
  sendWhatsAppTextMessage,
} from "./whatsappService.js";
import {
  CommitmentError,
  recordPartialPaymentOnCommitment,
} from "./commitmentService.js";

const inFlightReminderKeys = new Set();
const inFlightReplyKeys = new Set();

export const getTodayIST = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

const addDaysToISODate = (isoDate, days) => {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const formatDisplayDate = (dateValue) => {
  if (!dateValue) return "scheduled date";
  return new Date(dateValue).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
};

const formatRupees = (amount) =>
  `₹${Number(amount || 0).toLocaleString("en-IN")}`;

export const resolveReminderLanguage = (requestedLanguage, customerLanguage) => {
  const allowed = new Set(["Gujarati", "Hindi", "Hinglish", "English"]);
  if (requestedLanguage && allowed.has(requestedLanguage)) {
    return requestedLanguage;
  }
  if (customerLanguage && allowed.has(customerLanguage)) {
    return customerLanguage;
  }
  return "Hindi";
};

/**
 * Generate a polite reminder message in Gujarati, Hindi, Hinglish, or English
 * containing customer name, outstanding amount, and promised date.
 */
export const generateReminderMessage = ({
  customerName,
  amount,
  promisedDate,
  reminderType,
  language,
}) => {
  const name = customerName || "Customer";
  const formattedAmount = formatRupees(amount);
  const formattedDate = formatDisplayDate(promisedDate);

  if (language === "Gujarati") {
    if (reminderType === "overdue") {
      return `નમસ્તે ${name}, આપની ${formattedAmount} ની ચુકવણી તારીખ ${formattedDate} ના રોજ નક્કી હતી, જે હજુ બાકી છે. કૃપા કરીને ચુકવણી અથવા નવી તારીખ જણાવશો.`;
    }
    if (reminderType === "due_today") {
      return `નમસ્તે ${name}, યાદ અપાવવાનું કે આજે (${formattedDate}) આપની ${formattedAmount} ની ચુકવણી નક્કી છે. ચુકવણી થયા બાદ જણાવશો.`;
    }
    return `નમસ્તે ${name}, આપની ${formattedAmount} ની ચુકવણી તારીખ ${formattedDate} ના રોજ નક્કી છે. સમયસર ચુકવણી માટે વિનંતી છે.`;
  }

  if (language === "Hinglish") {
    if (reminderType === "overdue") {
      return `Namaste ${name} ji, aapka ${formattedAmount} ka payment ${formattedDate} ko due tha jo abhi baaki hai. Kripya payment kar dein ya nayi date batayein.`;
    }
    if (reminderType === "due_today") {
      return `Namaste ${name} ji, yaad dilana tha ki aaj (${formattedDate}) aapka ${formattedAmount} ka payment due hai. Payment hone par reply zaroor karein.`;
    }
    return `Namaste ${name} ji, aapka ${formattedAmount} ka payment ${formattedDate} ko scheduled hai. Kripya samay par payment kar dein.`;
  }

  if (language === "English") {
    if (reminderType === "overdue") {
      return `Hello ${name}, your payment of ${formattedAmount} was promised for ${formattedDate} and is currently overdue. Please reply with payment status or a revised date.`;
    }
    if (reminderType === "due_today") {
      return `Hello ${name}, this is a gentle reminder that your payment of ${formattedAmount} is due today (${formattedDate}). Please confirm once paid.`;
    }
    return `Hello ${name}, reminder that your payment of ${formattedAmount} is scheduled for ${formattedDate}. Thank you.`;
  }

  // Default: Hindi
  if (reminderType === "overdue") {
    return `नमस्ते ${name} जी, आपका ${formattedAmount} का भुगतान ${formattedDate} को तय था, जो अभी बाकी है। कृपया भुगतान करें या नई तारीख बताएं।`;
  }
  if (reminderType === "due_today") {
    return `नमस्ते ${name} जी, याद दिलाना है कि आज (${formattedDate}) आपका ${formattedAmount} का भुगतान तय है। भुगतान करने के बाद कृपया बताएं।`;
  }
  return `नमस्ते ${name} जी, आपका ${formattedAmount} का भुगतान ${formattedDate} को तय है। कृपया समय पर भुगतान करें।`;
};

export const classifyCommitmentTiming = (promisedDate, todayISO = getTodayIST(), upcomingDays = 3) => {
  const promisedISO = new Date(promisedDate).toISOString().slice(0, 10);
  const windowEndISO = addDaysToISODate(todayISO, upcomingDays);

  if (promisedISO < todayISO) return "overdue";
  if (promisedISO === todayISO) return "due_today";
  if (promisedISO <= windowEndISO) return "upcoming";
  return null;
};

/**
 * Identify upcoming, due-today, and overdue unpaid confirmed commitments.
 */
export const findReminderCandidates = async ({ upcomingDays = 3, language } = {}) => {
  const todayISO = getTodayIST();

  const commitments = await Commitment.find({
    confirmedByVendor: true,
    paymentStatus: "Unpaid",
    status: { $in: ["Pending", "Renegotiated", "Broken"] },
    amount: { $gte: 1 },
  })
    .populate("customer", "name phone preferredLanguage")
    .sort({ promisedDate: 1 });

  const todaySentReminders = await Reminder.find({
    reminderDateKey: todayISO,
    deliveryStatus: { $in: ["sent", "delivered", "read", "mock_sent"] },
  }).select("commitment deliveryStatus channel isMock");

  const sentByCommitmentId = new Map(
    todaySentReminders.map((r) => [r.commitment.toString(), r])
  );

  const candidates = [];

  for (const commitment of commitments) {
    if (!commitment.customer) continue;

    const reminderType = classifyCommitmentTiming(
      commitment.promisedDate,
      todayISO,
      upcomingDays
    );
    if (!reminderType) continue;

    const effectiveLanguage = resolveReminderLanguage(
      language,
      commitment.customer.preferredLanguage
    );
    const existingToday = sentByCommitmentId.get(commitment._id.toString());

    candidates.push({
      commitmentId: commitment._id,
      customer: commitment.customer,
      outstandingAmount: commitment.amount,
      promisedDate: commitment.promisedDate,
      status: commitment.status,
      reminderType,
      reminderDateKey: todayISO,
      language: effectiveLanguage,
      alreadySentToday: Boolean(existingToday),
      todayReminder: existingToday || null,
      previewMessage: generateReminderMessage({
        customerName: commitment.customer.name,
        amount: commitment.amount,
        promisedDate: commitment.promisedDate,
        reminderType,
        language: effectiveLanguage,
      }),
    });
  }

  return candidates;
};

/**
 * Send a single reminder with duplicate prevention for today's reminder cycle.
 */
export const sendReminderForCommitment = async ({
  commitmentId,
  language,
  upcomingDays = 3,
}) => {
  const todayISO = getTodayIST();
  const commitment = await Commitment.findById(commitmentId).populate(
    "customer",
    "name phone preferredLanguage"
  );

  if (!commitment) {
    return { status: 404, success: false, message: "Commitment not found" };
  }
  if (!commitment.customer) {
    return { status: 400, success: false, message: "Customer record not found" };
  }
  if (commitment.confirmedByVendor !== true) {
    return {
      status: 400,
      success: false,
      message: "Commitment must be confirmed by vendor before sending reminders",
    };
  }
  if (commitment.paymentStatus === "Paid") {
    return {
      status: 400,
      success: false,
      message: "Cannot send reminder for an already paid commitment",
    };
  }

  const reminderType =
    classifyCommitmentTiming(commitment.promisedDate, todayISO, upcomingDays) ||
    "upcoming";

  const lockKey = `${commitment._id.toString()}|${todayISO}`;
  if (inFlightReminderKeys.has(lockKey)) {
    return {
      status: 409,
      success: false,
      message: "Reminder dispatch already in progress for this commitment today",
    };
  }

  inFlightReminderKeys.add(lockKey);

  try {
    const existingReminder = await Reminder.findOne({
      commitment: commitment._id,
      reminderDateKey: todayISO,
      deliveryStatus: { $in: ["sent", "delivered", "read", "mock_sent"] },
    });

    if (existingReminder) {
      return {
        status: 409,
        success: false,
        duplicate: true,
        message: "Duplicate reminder prevented: already sent today",
        data: existingReminder,
      };
    }

    const effectiveLanguage = resolveReminderLanguage(
      language,
      commitment.customer.preferredLanguage
    );

    const text = generateReminderMessage({
      customerName: commitment.customer.name,
      amount: commitment.amount,
      promisedDate: commitment.promisedDate,
      reminderType,
      language: effectiveLanguage,
    });

    const dispatch = await sendWhatsAppTextMessage({
      toPhone: commitment.customer.phone,
      text,
    });

    const now = new Date();
    const reminder = await Reminder.create({
      commitment: commitment._id,
      customer: commitment.customer._id,
      reminderType,
      reminderDateKey: todayISO,
      language: effectiveLanguage,
      message: text,
      channel: dispatch.channel,
      isMock: dispatch.isMock,
      deliveryStatus: dispatch.deliveryStatus,
      providerMessageId: dispatch.providerMessageId,
      statusHistory: [
        {
          status: dispatch.deliveryStatus,
          timestamp: now,
          detail: dispatch.error || (dispatch.isMock ? "Mock adapter dispatch" : "Cloud API accepted"),
        },
      ],
      outstandingAmountSnapshot: commitment.amount,
      promisedDateSnapshot: commitment.promisedDate,
      sentAt: dispatch.success ? now : null,
      errorMessage: dispatch.error || null,
    });

    await reminder.populate("customer", "name phone preferredLanguage");

    return {
      status: dispatch.success ? 201 : 502,
      success: dispatch.success,
      message: dispatch.success
        ? dispatch.isMock
          ? "Reminder recorded via WhatsApp mock adapter (credentials not configured)"
          : "Reminder sent via WhatsApp Cloud API"
        : dispatch.error || "Failed to send reminder",
      data: reminder,
    };
  } finally {
    inFlightReminderKeys.delete(lockKey);
  }
};

/**
 * Find matching customer by phone number (matching last 10 digits if applicable).
 */
const findCustomerByPhone = async (fromPhone) => {
  const normalizedIncoming = normalizePhoneForWhatsApp(fromPhone);
  if (!normalizedIncoming) return null;

  const last10 = normalizedIncoming.slice(-10);
  const customers = await Customer.find();

  return (
    customers.find((c) => {
      const normalizedCust = normalizePhoneForWhatsApp(c.phone);
      return (
        normalizedCust === normalizedIncoming ||
        (last10.length === 10 && normalizedCust.slice(-10) === last10)
      );
    }) || null
  );
};

/**
 * Process an incoming customer reply: deduplicate, match customer/commitment,
 * run AI reply interpreter, and store for vendor confirmation without modifying
 * paymentStatus or promisedDate prematurely.
 */
export const processIncomingCustomerReply = async ({
  fromPhone,
  message,
  messageId = null,
  customerId = null,
  commitmentId = null,
  channel = "mock",
}) => {
  const trimmedMessage = typeof message === "string" ? message.trim() : "";
  const phone = typeof fromPhone === "string" ? fromPhone.trim() : "";

  if (!trimmedMessage) {
    return { status: 400, success: false, message: "Reply message is required" };
  }

  let customer = null;
  if (customerId) {
    customer = await Customer.findById(customerId);
  }
  if (!customer && phone) {
    customer = await findCustomerByPhone(phone);
  }

  const resolvedPhone = phone || customer?.phone || "";
  if (!resolvedPhone) {
    return { status: 400, success: false, message: "Customer phone or customerId is required" };
  }

  let commitment = null;
  if (commitmentId) {
    commitment = await Commitment.findById(commitmentId);
  } else if (customer) {
    commitment = await Commitment.findOne({
      customer: customer._id,
      confirmedByVendor: true,
      paymentStatus: "Unpaid",
    }).sort({ promisedDate: 1, createdAt: -1 });
  }

  const normalizedPhoneKey = normalizePhoneForWhatsApp(resolvedPhone) || resolvedPhone;
  const fingerprint = crypto
    .createHash("sha256")
    .update(
      `${normalizedPhoneKey}|${commitment?._id?.toString() || "none"}|${trimmedMessage.toLowerCase()}`
    )
    .digest("hex");

  const lockKey = messageId || fingerprint;
  if (inFlightReplyKeys.has(lockKey)) {
    return {
      status: 409,
      success: false,
      duplicate: true,
      message: "Incoming reply is already being processed",
    };
  }

  inFlightReplyKeys.add(lockKey);

  try {
    const duplicateQuery = messageId
      ? { $or: [{ messageId }, { messageFingerprint: fingerprint }] }
      : { messageFingerprint: fingerprint };

    const existingReply = await CustomerReply.findOne(duplicateQuery)
      .populate("customer", "name phone preferredLanguage")
      .populate("commitment", "amount originalAmount promisedDate status paymentStatus");

    if (existingReply) {
      return {
        status: 409,
        success: false,
        duplicate: true,
        message: "Duplicate incoming message ignored",
        data: existingReply,
      };
    }

    const latestReminder = commitment
      ? await Reminder.findOne({ commitment: commitment._id }).sort({ createdAt: -1 })
      : null;

    const aiInterpretation = await interpretCustomerReply(trimmedMessage, {
      customerName: customer?.name || null,
      outstandingAmount: commitment?.amount || null,
      promisedDate: commitment?.promisedDate
        ? new Date(commitment.promisedDate).toISOString().slice(0, 10)
        : null,
    });

    const confirmationStatus =
      aiInterpretation.classification === "unclear_response"
        ? "pending_vendor_confirmation"
        : "pending_vendor_confirmation";

    const replyDoc = await CustomerReply.create({
      customer: customer?._id || null,
      commitment: commitment?._id || null,
      relatedReminder: latestReminder?._id || null,
      fromPhone: resolvedPhone,
      messageId: messageId || null,
      messageFingerprint: fingerprint,
      rawMessage: trimmedMessage,
      channel,
      aiInterpretation,
      confirmationStatus,
    });

    await replyDoc.populate("customer", "name phone preferredLanguage");
    await replyDoc.populate(
      "commitment",
      "amount originalAmount promisedDate status paymentStatus"
    );

    return {
      status: 201,
      success: true,
      duplicate: false,
      message:
        "Customer reply interpreted and queued for vendor confirmation (no ledger changes made yet)",
      data: replyDoc,
    };
  } finally {
    inFlightReplyKeys.delete(lockKey);
  }
};

const isValidISODate = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
};

/**
 * Apply vendor-confirmed update from an interpreted customer reply.
 * Enforces explicit confirmation before any date, balance, or payment change.
 */
export const confirmCustomerReplyAction = async ({
  replyId,
  action,
  amount,
  promisedDate,
  vendorNote,
}) => {
  const reply = await CustomerReply.findById(replyId);
  if (!reply) {
    return { status: 404, success: false, message: "Customer reply not found" };
  }

  if (reply.confirmationStatus === "confirmed") {
    return {
      status: 409,
      success: false,
      message: "This customer reply has already been confirmed and applied",
    };
  }

  if (!reply.commitment) {
    return {
      status: 400,
      success: false,
      message: "No active unpaid commitment is linked to this reply",
    };
  }

  const commitment = await Commitment.findById(reply.commitment);
  if (!commitment) {
    return { status: 404, success: false, message: "Linked commitment not found" };
  }

  if (commitment.paymentStatus === "Paid") {
    return {
      status: 400,
      success: false,
      message: "Linked commitment is already marked as Paid",
    };
  }

  const resolvedAction =
    action ||
    (reply.aiInterpretation.classification === "payment_completed"
      ? "mark_paid"
      : reply.aiInterpretation.classification === "partial_payment"
        ? "partial_payment"
        : reply.aiInterpretation.classification === "new_payment_promise" ||
            reply.aiInterpretation.classification === "request_for_extension"
          ? "update_date"
          : null);

  if (!resolvedAction) {
    return {
      status: 400,
      success: false,
      message:
        "Unclear reply requires vendor to explicitly choose an action (mark_paid, partial_payment, update_date) or reject",
    };
  }

  const now = new Date();
  let appliedChanges = null;
  let partialPaymentDoc = null;

  if (resolvedAction === "mark_paid") {
    const prevStatus = commitment.status;
    const prevAmount = commitment.amount;
    if (!commitment.originalAmount) {
      commitment.originalAmount = commitment.amount;
    }
    commitment.paidAmount = commitment.originalAmount;
    commitment.paymentStatus = "Paid";
    commitment.paidAt = now;
    commitment.status = "Kept";
    commitment.history.push({
      action: "payment_completed_confirmed",
      previousAmount: prevAmount,
      newAmount: prevAmount,
      previousPromisedDate: commitment.promisedDate,
      newPromisedDate: commitment.promisedDate,
      previousStatus: prevStatus,
      newStatus: "Kept",
      note: vendorNote || "Vendor verified full payment claimed by customer",
      actor: "vendor",
      relatedReply: reply._id,
      createdAt: now,
    });
    await commitment.save();
    appliedChanges = {
      type: "mark_paid",
      paymentStatus: "Paid",
      status: "Kept",
      paidAmount: commitment.paidAmount,
    };
  } else if (resolvedAction === "partial_payment") {
    const candidateAmount = amount ?? reply.aiInterpretation.amount;
    const candidateDate = promisedDate ?? reply.aiInterpretation.proposedDate;
    try {
      const partialRes = await recordPartialPaymentOnCommitment({
        commitmentId: commitment._id,
        partialAmount: candidateAmount,
        newPromisedDate: candidateDate,
        originalMessage: `Partial payment from reply: ${reply.rawMessage}`,
        vendorNote,
        relatedReplyId: reply._id,
        actor: "vendor",
      });
      partialPaymentDoc = partialRes.partialPayment;
      appliedChanges = partialRes.appliedChanges;
    } catch (err) {
      if (err instanceof CommitmentError) {
        return { status: err.status, success: false, message: err.message };
      }
      throw err;
    }
  } else if (resolvedAction === "update_date") {
    const candidateDate = promisedDate ?? reply.aiInterpretation.proposedDate;
    if (!isValidISODate(candidateDate)) {
      return {
        status: 400,
        success: false,
        message:
          "A valid confirmed date in YYYY-MM-DD format is required to update the commitment",
      };
    }

    const todayISO = getTodayIST();
    if (candidateDate < todayISO) {
      return {
        status: 400,
        success: false,
        message: "New promised date cannot be in the past",
      };
    }

    const prevDate = commitment.promisedDate;
    const prevStatus = commitment.status;
    const nextDate = new Date(`${candidateDate}T00:00:00.000Z`);

    commitment.promisedDate = nextDate;
    commitment.status = "Renegotiated";
    commitment.history.push({
      action:
        reply.aiInterpretation.classification === "request_for_extension"
          ? "extension_confirmed"
          : "promised_date_updated",
      previousAmount: commitment.amount,
      newAmount: commitment.amount,
      previousPromisedDate: prevDate,
      newPromisedDate: nextDate,
      previousStatus: prevStatus,
      newStatus: "Renegotiated",
      note: vendorNote || `Promised date updated after reply: "${reply.rawMessage}"`,
      actor: "vendor",
      relatedReply: reply._id,
      createdAt: now,
    });
    await commitment.save();

    appliedChanges = {
      type: "update_date",
      previousPromisedDate: prevDate,
      newPromisedDate: nextDate,
      status: "Renegotiated",
      paymentStatus: commitment.paymentStatus,
    };
  } else {
    return {
      status: 400,
      success: false,
      message: "Unsupported confirmation action",
    };
  }

  reply.confirmationStatus = "confirmed";
  reply.confirmedAt = now;
  reply.vendorNote = vendorNote || null;
  reply.appliedChanges = appliedChanges;
  await reply.save();

  const refreshedCommitment = await Commitment.findById(commitment._id).populate(
    "customer",
    "name phone preferredLanguage"
  );
  await reply.populate("customer", "name phone preferredLanguage");
  await reply.populate(
    "commitment",
    "amount originalAmount paidAmount promisedDate status paymentStatus history"
  );

  return {
    status: 200,
    success: true,
    message: "Reply confirmed and commitment updated safely",
    data: {
      reply,
      commitment: refreshedCommitment,
      partialPayment: partialPaymentDoc,
    },
  };
};

/**
 * Update reminder delivery status from a WhatsApp status webhook callback.
 */
export const updateReminderDeliveryStatus = async ({
  providerMessageId,
  deliveryStatus,
  detail = null,
}) => {
  const allowed = new Set(["sent", "delivered", "read", "failed"]);
  if (!providerMessageId || !allowed.has(deliveryStatus)) {
    return null;
  }

  const reminder = await Reminder.findOne({ providerMessageId });
  if (!reminder) return null;

  reminder.deliveryStatus = deliveryStatus;
  reminder.statusHistory.push({
    status: deliveryStatus,
    timestamp: new Date(),
    detail,
  });
  if (deliveryStatus === "failed" && detail) {
    reminder.errorMessage = detail;
  }
  await reminder.save();
  return reminder;
};
