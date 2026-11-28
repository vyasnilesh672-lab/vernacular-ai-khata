
import { GoogleGenAI } from "@google/genai";

const ALLOWED_INTENTS = new Set([
  "payment_promise",
  "payment_received",
  "udhaar_balance",
  "payment_query",
  "other",
]);
const ALLOWED_LANGUAGES = new Set(["Gujarati", "Hindi", "English", "Hinglish"]);

const isValidISODate = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
};

const getCurrentISTContext = () => {
  const now = new Date();
  const dateISO = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
  }).format(now);
  const year = dateISO.slice(0, 4);

  const upcomingDays = Array.from({ length: 8 }, (_, offset) => {
    const d = new Date(`${dateISO}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + offset);
    const iso = d.toISOString().slice(0, 10);
    const dayName = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      weekday: "long",
    }).format(d);
    return `${iso} (${dayName})`;
  });

  return { dateISO, weekday, year, upcomingDays };
};

const parseModelJson = (rawText) => {
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const parsed = JSON.parse(cleaned);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Gemini returned an unexpected JSON structure");
  }
  return parsed;
};

const normalizeNullish = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (
      !trimmed ||
      trimmed.toLowerCase() === "null" ||
      trimmed.toLowerCase() === "undefined"
    ) {
      return null;
    }
    return trimmed;
  }
  return value;
};

const mapIntentToTransactionType = (intent) => {
  if (intent === "payment_received") return "payment_received";
  if (intent === "udhaar_balance") return "udhaar_balance";
  if (intent === "payment_promise") return "payment_promise";
  return "other";
};

const normalizeExtractedData = (raw, customers, todayISO) => {
  const rawCustomerId = normalizeNullish(raw.customerId);
  const matchedCustomer =
    typeof rawCustomerId === "string"
      ? customers.find((c) => c._id.toString() === rawCustomerId)
      : null;

  const rawMentionedName = normalizeNullish(
    raw.mentionedCustomer ?? raw.customerName
  );
  const mentionedCustomer =
    matchedCustomer
      ? matchedCustomer.name
      : typeof rawMentionedName === "string"
        ? rawMentionedName
        : null;

  const rawAmount = normalizeNullish(raw.amount);
  let amount = null;
  if (typeof rawAmount === "number") {
    amount = Number.isFinite(rawAmount) && rawAmount > 0 ? rawAmount : null;
  } else if (typeof rawAmount === "string") {
    const cleanedAmount = Number(rawAmount.replace(/[₹,\s]/g, ""));
    amount =
      Number.isFinite(cleanedAmount) && cleanedAmount > 0
        ? cleanedAmount
        : null;
  }

  const rawDate = normalizeNullish(raw.promisedDate);
  const promisedDate = isValidISODate(rawDate) ? rawDate : null;
  const dateAmbiguous = Boolean(raw.dateAmbiguous);

  const rawLanguage = normalizeNullish(raw.language);
  const language =
    typeof rawLanguage === "string" && ALLOWED_LANGUAGES.has(rawLanguage)
      ? rawLanguage
      : null;

  const rawIntent = normalizeNullish(raw.intent);
  const intent =
    typeof rawIntent === "string" && ALLOWED_INTENTS.has(rawIntent)
      ? rawIntent
      : "other";
  const transactionType = mapIntentToTransactionType(intent);

  const rawNotes = normalizeNullish(raw.notes);
  const notes = typeof rawNotes === "string" ? rawNotes : null;

  let confidence = Number(raw.confidence);
  if (!Number.isFinite(confidence) || confidence < 0) {
    confidence = 0;
  } else if (confidence > 1 && confidence <= 100) {
    confidence = confidence / 100;
  } else if (confidence > 1) {
    confidence = 1;
  }

  // Never show high confidence when extracted fields are missing, ambiguous, or in the past
  if (intent === "other" || intent === "payment_query") {
    confidence = Math.min(confidence, 0.45);
  }
  if (!matchedCustomer) {
    confidence = Math.min(confidence, 0.55);
  }
  if (amount === null || amount < 1) {
    confidence = Math.min(confidence, 0.5);
  }
  if (dateAmbiguous) {
    confidence = Math.min(confidence, 0.6);
  }
  if (
    (intent === "payment_promise" || intent === "udhaar_balance") &&
    promisedDate === null
  ) {
    confidence = Math.min(confidence, 0.6);
  }
  if (intent === "payment_promise" && promisedDate && promisedDate < todayISO) {
    confidence = Math.min(confidence, 0.6);
  }
  if (intent === "payment_received" && promisedDate === null) {
    confidence = Math.min(confidence, 0.7);
  }

  return {
    customerId: matchedCustomer ? matchedCustomer._id.toString() : null,
    customerName: matchedCustomer ? matchedCustomer.name : null,
    mentionedCustomer,
    amount,
    promisedDate,
    dateAmbiguous,
    language,
    intent,
    transactionType,
    notes,
    confidence: Number(confidence.toFixed(2)),
    needsConfirmation: true,
  };
};

export const extractPaymentDetails = async (message, customers) => {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is missing in server .env");
  }

  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
  });

  const { dateISO, weekday, year, upcomingDays } = getCurrentISTContext();

  const customerList = customers.map((customer) => ({
    id: customer._id.toString(),
    name: customer.name,
    phone: customer.phone,
  }));

  const prompt = `
You are an AI Khata (ledger) assistant for local Indian vendors.

Understand natural voice transcripts in Gujarati, Hindi, English, and Hinglish (code-mixed Gujarati/Hindi in Latin or Devanagari/Gujarati scripts).

Current date (IST): ${dateISO} (${weekday})
Current year: ${year}
Reference calendar (next 8 days): ${upcomingDays.join(", ")}

Existing customers:
${JSON.stringify(customerList)}

Vendor/Customer transcript:
${message}

Return ONLY valid JSON:
{
  "customerId": "matching customer ID from Existing customers or null",
  "customerName": "matched customer name or null",
  "mentionedCustomer": "spoken customer name even if not in Existing customers, or null",
  "amount": null,
  "promisedDate": null,
  "dateAmbiguous": false,
  "language": "Gujarati, Hindi, English, or Hinglish",
  "intent": "payment_promise, payment_received, udhaar_balance, payment_query, or other",
  "notes": "brief note on partial payment, discount, commission, or unit count (peti/katta/nag) if mentioned, else null",
  "confidence": 0,
  "needsConfirmation": true
}

VENDOR TERMINOLOGY & INTENT RULES:
- "payment_received": money already paid/deposited/received now or in the past.
  Examples: "jama karo", "jama kar", "malya", "mali gaya", "mila", "mil gaye", "de diya", "paid", "received", "account ma jama".
- "payment_promise": customer promises to pay on a future date (full or partial payment).
  Examples: "aapse", "aapi dese", "de dunga", "dunga", "dene wala hai", "kal dunga", "Friday e aapse", "baki ma thi 2000 kal aapse".
- "udhaar_balance": recording or stating an outstanding credit/balance owed ("baki", "baki che", "baaki hai", "udhaar", "udhar", "khata ma baki").
- "payment_query": asking how much is due or when someone will pay.
- "other": unclear, noisy, or unrelated speech with no clear ledger intent.
- Trade quantities like "peti", "katta", "nag", "bora", "packet" are item units, NOT currency amounts. Never treat a unit count (e.g., "5 katta") as ₹5.
- If "discount" or "commission" is mentioned alongside an amount (e.g., "2000 ma 100 discount"), extract the net payable/received rupee amount if clearly calculable, otherwise lower confidence and explain in "notes".
- If partial payment is mentioned (e.g., "5000 ma thi 2000 malya"), extract the actual paid/promised transaction amount (2000) and mention the context in "notes".

DATE RULES:
- Never invent or assume a date.
- Return "promisedDate" only in YYYY-MM-DD format, or null if no clear date is mentioned.
- For "aaje" / "aaj" / "today" (including "Aaje Suresh pase thi 1500 malya"), set promisedDate to ${dateISO}.
- For "kal" / "aavti kale" / "tomorrow", calculate using ${dateISO} (tomorrow is ${upcomingDays[1].slice(0, 10)}).
- For "next Monday", "this Wednesday", etc., use the Reference calendar above when unambiguous.
- IMPORTANT: If the message mentions a bare weekday name (e.g. "Friday e", "Friday ko") and today (${dateISO}) IS that same weekday (${weekday}), OR the date reference is vague (e.g. "next week", "thoda divas ma", "mahina na end ma", "baad mein"), set "dateAmbiguous": true and return promisedDate as null (or lower confidence <= 0.5) so the vendor confirms the exact date.
- If a date is mentioned without a year, use ${year}.
- Never interpret an amount, phone number, or unit count as a date or year.
- If a promisedDate for a payment_promise is before ${dateISO}, do not silently change it; return it and lower confidence.

CUSTOMER & CONFIDENCE RULES:
- Match customer names (including Gujarati/Hindi/English transliterations or honorifics like -bhai, -ji) against Existing customers.
- Never guess or invent a customerId. If the spoken customer does not clearly match an entry in Existing customers, set customerId and customerName to null, and put the spoken name in mentionedCustomer.
- Confidence must be between 0 and 1. Do NOT output high confidence (such as 0.9 or 0.95) if customer, amount, date, or intent is missing, ambiguous, or uncertain.
- Always set needsConfirmation to true.
`;

  let response;

  try {
    response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      },
    });
  } catch {
    console.log("Primary Gemini model unavailable. Trying fallback...");

    response = await ai.models.generateContent({
      model: "gemini-3.5-flash-lite",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      },
    });
  }

  if (!response.text) {
    throw new Error("Gemini returned an empty response");
  }

  const parsed = parseModelJson(response.text);
  return normalizeExtractedData(parsed, customers, dateISO);
};

const ALLOWED_REPLY_CLASSIFICATIONS = new Set([
  "payment_completed",
  "partial_payment",
  "new_payment_promise",
  "request_for_extension",
  "unclear_response",
]);

const recommendedActionForReply = (classification, amount, proposedDate, dateAmbiguous) => {
  if (classification === "payment_completed") {
    return "confirm_payment_received";
  }
  if (classification === "partial_payment") {
    return amount && amount >= 1 ? "confirm_partial_payment" : "clarify_with_vendor";
  }
  if (
    (classification === "new_payment_promise" ||
      classification === "request_for_extension") &&
    proposedDate &&
    !dateAmbiguous
  ) {
    return "confirm_new_date";
  }
  return "clarify_with_vendor";
};

const normalizeReplyInterpretation = (raw, todayISO) => {
  const rawClass = normalizeNullish(raw.classification);
  const classification =
    typeof rawClass === "string" && ALLOWED_REPLY_CLASSIFICATIONS.has(rawClass)
      ? rawClass
      : "unclear_response";

  const rawAmount = normalizeNullish(raw.amount);
  let amount = null;
  if (typeof rawAmount === "number") {
    amount = Number.isFinite(rawAmount) && rawAmount > 0 ? rawAmount : null;
  } else if (typeof rawAmount === "string") {
    const cleaned = Number(rawAmount.replace(/[₹,\s]/g, ""));
    amount = Number.isFinite(cleaned) && cleaned > 0 ? cleaned : null;
  }

  const rawDate = normalizeNullish(raw.proposedDate);
  let proposedDate = isValidISODate(rawDate) ? rawDate : null;
  let dateAmbiguous = Boolean(raw.dateAmbiguous);

  if (
    proposedDate &&
    (classification === "new_payment_promise" ||
      classification === "request_for_extension") &&
    proposedDate < todayISO
  ) {
    dateAmbiguous = true;
    proposedDate = null;
  }

  const rawLanguage = normalizeNullish(raw.language);
  const language =
    typeof rawLanguage === "string" && ALLOWED_LANGUAGES.has(rawLanguage)
      ? rawLanguage
      : null;

  const rawSummary = normalizeNullish(raw.summary);
  const summary = typeof rawSummary === "string" ? rawSummary : null;

  let confidence = Number(raw.confidence);
  if (!Number.isFinite(confidence) || confidence < 0) {
    confidence = 0;
  } else if (confidence > 1 && confidence <= 100) {
    confidence = confidence / 100;
  } else if (confidence > 1) {
    confidence = 1;
  }

  if (classification === "unclear_response") {
    confidence = Math.min(confidence, 0.4);
  }
  if (dateAmbiguous) {
    confidence = Math.min(confidence, 0.6);
  }
  if (
    (classification === "new_payment_promise" ||
      classification === "request_for_extension") &&
    !proposedDate
  ) {
    confidence = Math.min(confidence, 0.6);
  }
  if (classification === "partial_payment" && (!amount || amount < 1)) {
    confidence = Math.min(confidence, 0.5);
  }

  return {
    classification,
    amount,
    proposedDate,
    dateAmbiguous,
    language,
    summary,
    confidence: Number(confidence.toFixed(2)),
    requiresVendorConfirmation: true,
    recommendedAction: recommendedActionForReply(
      classification,
      amount,
      proposedDate,
      dateAmbiguous
    ),
  };
};

/**
 * Interpret an incoming customer reply to a payment reminder using Gemini AI.
 * Never mutates ledger state; returns structured classification for vendor review.
 */
export const interpretCustomerReply = async (replyMessage, context = {}) => {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is missing in server .env");
  }

  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
  });

  const { dateISO, weekday, year, upcomingDays } = getCurrentISTContext();
  const { customerName, outstandingAmount, promisedDate } = context;

  const prompt = `
You are an AI Khata assistant interpreting a customer's reply to a payment reminder.
Understand Gujarati, Hindi, English, and Hinglish messages.

Current date (IST): ${dateISO} (${weekday})
Current year: ${year}
Reference calendar (next 8 days): ${upcomingDays.join(", ")}

Commitment context:
- Customer: ${customerName || "Unknown"}
- Outstanding amount: ${outstandingAmount ? `₹${outstandingAmount}` : "Unknown"}
- Current promised date: ${promisedDate || "Unknown"}

Customer reply:
${replyMessage}

Return ONLY valid JSON:
{
  "classification": "payment_completed | partial_payment | new_payment_promise | request_for_extension | unclear_response",
  "amount": null,
  "proposedDate": null,
  "dateAmbiguous": false,
  "language": "Gujarati, Hindi, English, or Hinglish",
  "summary": "short plain-English summary for vendor confirmation",
  "confidence": 0,
  "requiresVendorConfirmation": true
}

CLASSIFICATION RULES:
- "payment_completed": Customer claims they have already paid in full (e.g., "Payment kar diya", "bhej diya", "transfer kari didhu", "jama kara diya"). Note: vendor must still verify receipt!
- "partial_payment": Customer says they paid or are sending part of the balance (e.g., "Abhi 2000 bhej raha hu, baaki baad mein", "5000 ma thi 2000 muklya"). Extract the partial rupee amount in "amount".
- "new_payment_promise": Customer commits to a specific new date to pay (e.g., "Kal pakka de dunga", "28 November ko de dunga").
- "request_for_extension": Customer asks for more time or an extension (e.g., "Friday tak time do", "Thoda aur time chahiye", "Agle hafte de dunga").
- "unclear_response": Reply is vague, off-topic, confusing, or cannot be categorized reliably.

DATE & CONFIDENCE RULES:
- Never invent a date. Use YYYY-MM-DD or null.
- For "kal" / "tomorrow", resolve using ${dateISO} -> ${upcomingDays[1].slice(0, 10)}.
- For "aaj" / "today" / "abhi", if used for a payment claim/partial payment, set proposedDate to ${dateISO} or null if future remainder date is unspecified.
- IMPORTANT: If the customer mentions a bare weekday name (like "Friday tak") and today (${dateISO}) IS ${weekday}, OR says vague timeframes ("agle hafte", "next week", "thoda aur time", "baad mein", "thoda divas"), set "dateAmbiguous": true, "proposedDate": null, and lower confidence (<= 0.6).
- If a date is mentioned without a year, use ${year}.
- Do NOT output high confidence (0.9+) when date is ambiguous, amount is missing for partial_payment, or intent is unclear.
- Always set "requiresVendorConfirmation": true.
`;

  let response;

  try {
    response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      },
    });
  } catch {
    console.log("Primary Gemini model unavailable. Trying fallback...");

    response = await ai.models.generateContent({
      model: "gemini-3.5-flash-lite",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      },
    });
  }

  if (!response.text) {
    throw new Error("Gemini returned an empty response");
  }

  const parsed = parseModelJson(response.text);
  return normalizeReplyInterpretation(parsed, dateISO);
};

const ALLOWED_INVENTORY_COMMANDS = new Set([
  "inventory_purchase",
  "inventory_transform",
  "inventory_sale",
  "other",
]);

/**
 * Parse a conversational Gujarati/Hindi/Hinglish/English inventory voice command
 * into a structured preview (read-only; never mutates inventory automatically).
 */
export const interpretInventoryCommand = async (
  message,
  { products = [], customers = [], recipes = [] } = {}
) => {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is missing in server .env");
  }

  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
  });

  const { dateISO, weekday } = getCurrentISTContext();

  const productList = products.map((p) => ({
    id: p._id.toString(),
    name: p.name,
    unit: p.unit,
    role: p.productRole,
  }));
  const customerList = customers.map((c) => ({
    id: c._id.toString(),
    name: c.name,
    phone: c.phone,
  }));
  const recipeList = recipes.map((r) => ({
    id: r._id.toString(),
    name: r.name,
    inputProductId: r.inputProduct?._id?.toString() || r.inputProduct?.toString(),
    inputUnit: r.inputUnit,
  }));

  const prompt = `
You are an AI inventory & production assistant for local Indian vendors.
Understand Gujarati, Hindi, English, and Hinglish commands.
Current date (IST): ${dateISO} (${weekday})

Available products: ${JSON.stringify(productList)}
Available customers: ${JSON.stringify(customerList)}
Available transformation recipes: ${JSON.stringify(recipeList)}

Vendor command:
${message}

Return ONLY valid JSON:
{
  "commandType": "inventory_purchase | inventory_transform | inventory_sale | other",
  "productId": "matching product ID or null",
  "productName": "matched product name or null",
  "customerId": "matching customer ID or null",
  "customerName": "matched customer name or null",
  "recipeId": "matching recipe ID for transform or null",
  "quantity": null,
  "unit": "kg | gram | litre | ml | piece | packet | peti | katta | nag | bora | box | null",
  "unitPrice": null,
  "unitCost": null,
  "language": "Gujarati, Hindi, English, or Hinglish",
  "confidence": 0,
  "needsConfirmation": true
}

RULES:
- "inventory_purchase": adding/receiving stock (e.g., "Aaje 20 kilo raw garlic aavyu", "10 kg onion kharida"). Map "kilo" -> "kg", "gm"/"grams" -> "gram".
- "inventory_transform": processing/converting raw material (e.g., "10 kilo garlic peel karo", "20 kg haldi grind karo"). Match input product and recipeId if applicable.
- "inventory_sale": selling stock to a customer at a rate (e.g., "Rameshbhai ne 5 kilo 150 rupiya kilo na bhave aapyu"). Extract customerId, productId, quantity, unit, unitPrice (150).
- Never invent IDs or numbers not in the command or lists.
- Always set needsConfirmation to true.
`;

  let response;
  try {
    response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: prompt,
      config: { responseMimeType: "application/json" },
    });
  } catch {
    console.log("Primary Gemini model unavailable. Trying fallback...");
    response = await ai.models.generateContent({
      model: "gemini-3.5-flash-lite",
      contents: prompt,
      config: { responseMimeType: "application/json" },
    });
  }

  if (!response.text) {
    throw new Error("Gemini returned an empty response");
  }

  const parsed = parseModelJson(response.text);

  const rawCmd = normalizeNullish(parsed.commandType);
  const commandType =
    typeof rawCmd === "string" && ALLOWED_INVENTORY_COMMANDS.has(rawCmd)
      ? rawCmd
      : "other";

  const rawProdId = normalizeNullish(parsed.productId);
  const matchedProduct =
    typeof rawProdId === "string"
      ? products.find((p) => p._id.toString() === rawProdId)
      : null;

  const rawCustId = normalizeNullish(parsed.customerId);
  const matchedCustomer =
    typeof rawCustId === "string"
      ? customers.find((c) => c._id.toString() === rawCustId)
      : null;

  const rawRecipeId = normalizeNullish(parsed.recipeId);
  const matchedRecipe =
    typeof rawRecipeId === "string"
      ? recipes.find((r) => r._id.toString() === rawRecipeId)
      : null;

  const qty = Number(parsed.quantity);
  const quantity = Number.isFinite(qty) && qty > 0 ? qty : null;

  const rawUnit = normalizeNullish(parsed.unit);
  const unit =
    typeof rawUnit === "string" ? rawUnit.toLowerCase() : null;

  const priceNum = Number(parsed.unitPrice);
  const unitPrice =
    parsed.unitPrice !== null &&
    parsed.unitPrice !== undefined &&
    Number.isFinite(priceNum) &&
    priceNum >= 0
      ? priceNum
      : null;

  const costNum = Number(parsed.unitCost);
  const unitCost =
    parsed.unitCost !== null &&
    parsed.unitCost !== undefined &&
    Number.isFinite(costNum) &&
    costNum >= 0
      ? costNum
      : null;

  let confidence = Number(parsed.confidence);
  if (!Number.isFinite(confidence) || confidence < 0) confidence = 0;
  if (confidence > 1 && confidence <= 100) confidence /= 100;
  if (confidence > 1) confidence = 1;
  if (commandType === "other" || !quantity) {
    confidence = Math.min(confidence, 0.5);
  }

  return {
    commandType,
    productId: matchedProduct ? matchedProduct._id.toString() : null,
    productName: matchedProduct ? matchedProduct.name : normalizeNullish(parsed.productName),
    customerId: matchedCustomer ? matchedCustomer._id.toString() : null,
    customerName: matchedCustomer ? matchedCustomer.name : normalizeNullish(parsed.customerName),
    recipeId: matchedRecipe ? matchedRecipe._id.toString() : null,
    quantity,
    unit,
    unitPrice,
    unitCost,
    language: normalizeNullish(parsed.language),
    confidence: Number(confidence.toFixed(2)),
    needsConfirmation: true,
  };
};

/**
 * Convert pre-calculated factual customer insights into simple Gujarati, Hindi, or Hinglish
 * explanations without altering or inventing any numbers.
 */
export const translateCustomerInsights = async (
  insights = [],
  { customerName, targetLanguage = "Hinglish" } = {}
) => {
  if (!Array.isArray(insights) || insights.length === 0) {
    return [];
  }
  if (!process.env.GEMINI_API_KEY) {
    return insights;
  }

  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
  });

  const prompt = `
Translate these verified customer ledger facts into simple, polite ${targetLanguage} for an Indian shopkeeper.
Customer: ${customerName || "Customer"}
Facts:
${JSON.stringify(insights)}

RULES:
- Preserve every number, rupee amount, count, and fact EXACTLY. Never invent or estimate any numbers.
- Return ONLY valid JSON: { "translatedInsights": ["..."] } with the same number of items as Facts.
`;

  let response;
  try {
    response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: prompt,
      config: { responseMimeType: "application/json" },
    });
  } catch {
    response = await ai.models.generateContent({
      model: "gemini-3.5-flash-lite",
      contents: prompt,
      config: { responseMimeType: "application/json" },
    });
  }

  if (!response?.text) {
    return insights;
  }

  const parsed = parseModelJson(response.text);
  return Array.isArray(parsed.translatedInsights) &&
    parsed.translatedInsights.length === insights.length
    ? parsed.translatedInsights
    : insights;
};

const ALLOWED_UNIFIED_CATEGORIES = new Set([
  "payment_received",
  "payment_promise",
  "partial_payment",
  "inventory_purchase",
  "inventory_deduction",
  "product_transformation",
  "inventory_sale",
  "customer_info_query",
  "customer_outstanding_query",
  "customer_risk_query",
  "confirm_pending",
  "reject_pending",
  "modify_pending",
  "unclear",
]);

/**
 * Unified vernacular AI command interpreter across payments, inventory,
 * transformations, customer intelligence queries, and multi-turn edits.
 * Strictly read-only: never mutates MongoDB.
 */
export const interpretUnifiedCommand = async (
  message,
  { customers = [], products = [], recipes = [], currentSession = null } = {}
) => {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is missing in server .env");
  }

  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
  });

  const { dateISO, weekday, year, upcomingDays } = getCurrentISTContext();

  const customerList = customers.map((c) => ({
    id: c._id.toString(),
    name: c.name,
    phone: c.phone,
  }));
  const productList = products.map((p) => ({
    id: p._id.toString(),
    name: p.name,
    unit: p.unit,
    role: p.productRole,
  }));
  const recipeList = recipes.map((r) => ({
    id: r._id.toString(),
    name: r.name,
    inputProductId: r.inputProduct?._id?.toString() || r.inputProduct?.toString(),
    defaultInputQuantity: r.defaultInputQuantity,
    inputUnit: r.inputUnit,
  }));

  const contextBlock = currentSession
    ? `
ACTIVE MULTI-TURN DRAFT CONTEXT:
- Current category: ${currentSession.commandCategory}
- Current status: ${currentSession.status}
- Current draft parameters: ${JSON.stringify(currentSession.draft)}
- Pending validation issues: ${JSON.stringify(currentSession.validationErrors || [])}
`
    : "No active multi-turn draft.";

  const prompt = `
You are the unified AI command interpreter for Vernacular AI Khata (Indian local vendor ledger & inventory system).
Understand Gujarati, Hindi, English, and Hinglish.

Current date (IST): ${dateISO} (${weekday})
Current year: ${year}
Reference calendar (next 8 days): ${upcomingDays.join(", ")}

Customers: ${JSON.stringify(customerList)}
Products: ${JSON.stringify(productList)}
Transformation recipes: ${JSON.stringify(recipeList)}

${contextBlock}

Vendor message:
${message}

Return ONLY valid JSON:
{
  "commandCategory": "payment_received | payment_promise | partial_payment | inventory_purchase | inventory_deduction | product_transformation | inventory_sale | customer_info_query | customer_outstanding_query | customer_risk_query | confirm_pending | reject_pending | modify_pending | unclear",
  "customerId": "matched customer ID or null",
  "mentionedCustomer": "spoken customer name or null",
  "amount": null,
  "promisedDate": null,
  "dateAmbiguous": false,
  "productId": "matched product ID or null",
  "mentionedProduct": "spoken product name or null",
  "quantity": null,
  "unit": "kg | gram | litre | ml | piece | packet | peti | katta | nag | bora | box | null",
  "unitPrice": null,
  "unitCost": null,
  "recipeId": "matched recipe ID or null",
  "outputs": [],
  "processingLoss": null,
  "processingCost": null,
  "language": "Gujarati, Hindi, English, or Hinglish",
  "notes": null,
  "confidence": 0
}

CATEGORY RULES:
- "payment_received": full payment received/deposited ("jama karo", "malya", "mil gaye", "payment aa gaya", "de diya").
- "payment_promise": future payment commitment ("aapvana che", "aapse", "de dunga", "kal dunga", "promise").
- "partial_payment": partial payment against existing udhaar ("5000 ma thi 2000 malya", "abhi 2000 de raha hu baaki baad mein", "partial payment").
- "inventory_purchase": stock received/bought ("20 kilo raw garlic aavyu", "10 kg onion kharida").
- "inventory_deduction": wastage/manual stock removal ("2 kilo kharab thai gayu kadhi nakho", "deduct karo").
- "product_transformation": converting raw material into finished/by-products ("10 kilo raw garlic peel karo", "10 kg garlic transform karo"). If explicit outputs are given in message, populate "outputs": [{"productId": "...", "productName": "...", "role": "finished_good|by_product", "quantity": number, "unit": "..."}].
- "inventory_sale": selling inventory to a customer ("Rameshbhai ne 5 kilo peeled garlic 150 na bhave aapyu", "becha").
- "customer_info_query": asking for customer profile/history/details ("ni details batao", "ka profile dikhao").
- "customer_outstanding_query": asking how much customer owes ("ketla baki che", "kitna udhaar baaki hai", "outstanding batao").
- "customer_risk_query": asking customer reliability/risk ("udhaar aapay ke nai", "risk score", "bharosa layak che?").
- ONLY when ACTIVE MULTI-TURN DRAFT CONTEXT exists:
  - "confirm_pending": vendor explicitly confirms ("confirm", "haan confirm karo", "save karo", "pakka").
  - "reject_pending": vendor rejects/cancels ("cancel", "reject", "nahi", "mat karo").
  - "modify_pending": vendor updates/clarifies a field on the active draft ("Date Friday rakho", "Next Friday rakho", "Kal rakho", "Amount 4000 karo", "Customer Rahul rakho", "20 kilo karo"). Return only the updated fields (plus existing draft fields if clear).
- "unclear": ambiguous or unrecognizable command.

DATE, ENTITY & SAFETY RULES:
- Never invent customerId, productId, amount, quantity, or promisedDate.
- "promisedDate" represents the promised due date (for payment_promise) OR the transaction/receipt date (for payment_received).
- For "aaje"/"aaj"/"today" (including "Aaje Rahul Patel pase thi 1800 malya"), ALWAYS return ${dateISO} in "promisedDate". For "kal"/"tomorrow", return ${upcomingDays[1].slice(0, 10)}. For "next Monday", use the reference calendar.
- If a bare weekday name (e.g., "Friday", "Date Friday rakho") matches today's weekday (${weekday}) OR date is vague ("agle hafte", "baad mein"), set "dateAmbiguous": true and "promisedDate": null!
- Convert "kilo" -> "kg", "gm"/"grams" -> "gram".
- Never confuse unit counts ("5 katta") with rupee amounts, and never confuse rupee prices with dates.
- Confidence must be 0..1 and lowered when anything is missing or ambiguous.
`;

  let response;
  try {
    response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: prompt,
      config: { responseMimeType: "application/json" },
    });
  } catch {
    console.log("Primary Gemini model unavailable. Trying fallback...");
    response = await ai.models.generateContent({
      model: "gemini-3.5-flash-lite",
      contents: prompt,
      config: { responseMimeType: "application/json" },
    });
  }

  if (!response?.text) {
    throw new Error("Gemini returned an empty response");
  }

  const parsed = parseModelJson(response.text);
  const rawCat = normalizeNullish(parsed.commandCategory);
  const commandCategory =
    typeof rawCat === "string" && ALLOWED_UNIFIED_CATEGORIES.has(rawCat)
      ? rawCat
      : "unclear";

  const rawCustId = normalizeNullish(parsed.customerId);
  const matchedCustomer =
    typeof rawCustId === "string"
      ? customers.find((c) => c._id.toString() === rawCustId)
      : null;

  const rawProdId = normalizeNullish(parsed.productId);
  const matchedProduct =
    typeof rawProdId === "string"
      ? products.find((p) => p._id.toString() === rawProdId)
      : null;

  const rawRecipeId = normalizeNullish(parsed.recipeId);
  const matchedRecipe =
    typeof rawRecipeId === "string"
      ? recipes.find((r) => r._id.toString() === rawRecipeId)
      : null;

  const numOrNull = (val, allowZero = false) => {
    const cleaned = normalizeNullish(val);
    if (cleaned === null) return null;
    const n =
      typeof cleaned === "number"
        ? cleaned
        : Number(String(cleaned).replace(/[₹,\s]/g, ""));
    if (!Number.isFinite(n)) return null;
    return allowZero ? (n >= 0 ? n : null) : n > 0 ? n : null;
  };

  const rawDate = normalizeNullish(parsed.promisedDate);
  const promisedDate = isValidISODate(rawDate) ? rawDate : null;
  const dateAmbiguous = Boolean(parsed.dateAmbiguous);

  const rawUnit = normalizeNullish(parsed.unit);
  const unit = typeof rawUnit === "string" ? rawUnit.trim().toLowerCase() : null;

  let confidence = Number(parsed.confidence);
  if (!Number.isFinite(confidence) || confidence < 0) confidence = 0;
  if (confidence > 1 && confidence <= 100) confidence /= 100;
  if (confidence > 1) confidence = 1;
  if (commandCategory === "unclear" || dateAmbiguous) {
    confidence = Math.min(confidence, 0.55);
  }

  const normalizedOutputs = Array.isArray(parsed.outputs)
    ? parsed.outputs
        .map((out) => {
          const outProdId = normalizeNullish(out?.productId);
          const outProd =
            typeof outProdId === "string"
              ? products.find((p) => p._id.toString() === outProdId)
              : null;
          const outQty = numOrNull(out?.quantity);
          const outUnit = normalizeNullish(out?.unit);
          if (!outProd || !outQty) return null;
          return {
            productId: outProd._id.toString(),
            productName: outProd.name,
            role: out?.role === "by_product" ? "by_product" : outProd.productRole === "by_product" ? "by_product" : "finished_good",
            quantity: outQty,
            unit: typeof outUnit === "string" ? outUnit.trim().toLowerCase() : outProd.unit,
          };
        })
        .filter(Boolean)
    : [];

  return {
    commandCategory,
    customerId: matchedCustomer ? matchedCustomer._id.toString() : null,
    customerName: matchedCustomer ? matchedCustomer.name : null,
    mentionedCustomer:
      matchedCustomer
        ? matchedCustomer.name
        : normalizeNullish(parsed.mentionedCustomer),
    amount: numOrNull(parsed.amount),
    promisedDate,
    dateAmbiguous,
    productId: matchedProduct ? matchedProduct._id.toString() : null,
    productName: matchedProduct ? matchedProduct.name : null,
    mentionedProduct:
      matchedProduct
        ? matchedProduct.name
        : normalizeNullish(parsed.mentionedProduct),
    quantity: numOrNull(parsed.quantity),
    unit,
    unitPrice: numOrNull(parsed.unitPrice, true),
    unitCost: numOrNull(parsed.unitCost, true),
    recipeId: matchedRecipe ? matchedRecipe._id.toString() : null,
    outputs: normalizedOutputs,
    processingLoss: numOrNull(parsed.processingLoss, true),
    processingCost: numOrNull(parsed.processingCost, true),
    language:
      typeof normalizeNullish(parsed.language) === "string" &&
      ALLOWED_LANGUAGES.has(normalizeNullish(parsed.language))
        ? normalizeNullish(parsed.language)
        : null,
    notes: normalizeNullish(parsed.notes),
    confidence: Number(confidence.toFixed(2)),
  };
};
