
import { GoogleGenAI } from "@google/genai";

export const extractPaymentDetails = async (message, customers) => {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is missing in server .env");
  }

  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
  });

  const customerList = customers.map((customer) => ({
    id: customer._id.toString(),
    name: customer.name,
    phone: customer.phone,
  }));

  const prompt = `
You are an AI payment commitment assistant for Indian local vendors.

Understand messages in Gujarati, Hindi or English.

Existing customers:
${JSON.stringify(customerList)}

Customer message:
${message}

Return ONLY valid JSON:
{
  "customerId": "matching customer ID or null",
  "customerName": "customer name or null",
  "amount": null,
  "promisedDate": null,
  "language": "Gujarati, Hindi or English",
  "intent": "payment_promise, payment_query, or other",
  "confidence": 0,
  "needsConfirmation": true
}

Rules:
- Never invent customer, amount or date.
- Amount must be a number or null.
- Date must be YYYY-MM-DD or null.
- Match only an existing customer.
- Confidence must be between 0 and 1.
- Always require vendor confirmation.
- If the message contains a date without a year,
  use the current year (2026).
- Never interpret an amount as a year.
- For example, "27 November 2000 rupees"
  means date = 2026-11-27 and amount = 2000.
- If customer is not clearly identified,
  return customerId and customerName as null.
- Never guess a customer based only on the speaker.
- Match customer names against the existing customer list.
- Customer names may be written in Gujarati, Hindi,
  or English transliteration.
- If the message does not mention a customer name,
  do not automatically assume the speaker is an existing customer.
- Return null if the customer cannot be reliably identified.
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
  } catch (primaryError) {
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

  return JSON.parse(response.text);
};
