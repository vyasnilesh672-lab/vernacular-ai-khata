
const API_URL = "http://localhost:5000/api";

export const getCustomers = async () => {
  const response = await fetch(`${API_URL}/customers`);

  if (!response.ok) {
    throw new Error("Failed to fetch customers");
  }

  const result = await response.json();
  return result.data;
};

export const addCustomer = async (customerData) => {
  const response = await fetch(`${API_URL}/customers`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(customerData),
  });
  

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.message || "Failed to add customer");
  }

  return result.data;
};

export const getCommitments = async () => {
  const response = await fetch(`${API_URL}/commitments`);

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.message || "Failed to fetch commitments");
  }

  return result.data;
};

export const markPaymentReceived = async (commitmentId) => {
  const response = await fetch(
    `${API_URL}/commitments/${commitmentId}/payment`,
    {
      method: "PATCH",
    }
  );

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.message || "Failed to update payment");
  }

  return result.data;
};
export const updateCommitmentStatus = async (id, status) => {
  const response = await fetch(`${API_URL}/commitments/${id}/status`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status }),
  });
  

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.message || "Failed to update promise status");
  }

  return result.data;
};
export const extractPaymentDetails = async (message) => {
  const response = await fetch(`${API_URL}/ai/extract`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message }),
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.message || "AI extraction failed");
  }

  return result.data;
};
const parseJsonSafe = async (response) => {
  try {
    return await response.json();
  } catch {
    return {};
  }
};

const createApiError = (response, result, fallbackMessage) => {
  const err = new Error(result?.message || fallbackMessage);
  err.status = response.status;
  err.data = result;
  return err;
};

export const createCommitment = async (commitmentData) => {
  const response = await fetch(`${API_URL}/commitments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commitmentData),
  });

  const result = await parseJsonSafe(response);

  if (!response.ok) {
    throw createApiError(response, result, "Failed to save commitment");
  }

  return result.data;
};

export const sendUnifiedCommand = async ({
  message,
  sessionId,
  confirmationToken,
  overrides,
}) => {
  const payload = { message };
  if (sessionId) payload.sessionId = sessionId;
  if (confirmationToken) payload.confirmationToken = confirmationToken;
  if (overrides) payload.overrides = overrides;

  const response = await fetch(`${API_URL}/commands`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const result = await parseJsonSafe(response);

  if (!response.ok) {
    throw createApiError(response, result, "Failed to process command");
  }

  return result.data;
};

export const confirmUnifiedCommand = async ({
  sessionId,
  confirmationToken,
  idempotencyKey,
}) => {
  const payload = { confirmationToken };
  if (idempotencyKey) payload.idempotencyKey = idempotencyKey;

  const response = await fetch(`${API_URL}/commands/${sessionId}/confirm`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const result = await parseJsonSafe(response);

  if (!response.ok) {
    throw createApiError(response, result, "Failed to confirm command");
  }

  return result.data;
};

export const rejectUnifiedCommand = async ({ sessionId, reason }) => {
  const response = await fetch(`${API_URL}/commands/${sessionId}/reject`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(reason ? { reason } : {}),
  });

  const result = await parseJsonSafe(response);

  if (!response.ok) {
    throw createApiError(response, result, "Failed to reject command");
  }

  return result.data;
};

export const getUnifiedCommandSession = async (sessionId) => {
  const response = await fetch(`${API_URL}/commands/${sessionId}`);
  const result = await parseJsonSafe(response);

  if (!response.ok) {
    throw createApiError(response, result, "Failed to load command session");
  }

  return result.data;
};

export const getCustomerPaymentHistory = async (customerId, params = {}) => {
  const query = new URLSearchParams();
  if (params.page) query.set("page", String(params.page));
  if (params.limit) query.set("limit", String(params.limit));
  if (params.entryKind) query.set("entryKind", params.entryKind);

  const suffix = query.toString() ? `?${query.toString()}` : "";
  const response = await fetch(`${API_URL}/customers/${customerId}/history${suffix}`);
  const result = await parseJsonSafe(response);

  if (!response.ok) {
    throw createApiError(response, result, "Failed to fetch customer history");
  }

  return result;
};

export const getRecentCommands = async (limit = 15) => {
  const response = await fetch(`${API_URL}/commands?limit=${limit}`);
  const result = await parseJsonSafe(response);
  if (!response.ok) {
    throw createApiError(response, result, "Failed to fetch recent AI activity");
  }
  return result.data;
};

export const getInventoryProducts = async () => {
  const response = await fetch(`${API_URL}/inventory/products`);
  const result = await parseJsonSafe(response);
  if (!response.ok) {
    throw createApiError(response, result, "Failed to fetch inventory products");
  }
  return result.data;
};

export const createInventoryProduct = async (productData) => {
  const response = await fetch(`${API_URL}/inventory/products`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(productData),
  });
  const result = await parseJsonSafe(response);
  if (!response.ok) {
    throw createApiError(response, result, "Failed to create product");
  }
  return result.data;
};

export const recordInventoryPurchase = async (productId, body) => {
  const response = await fetch(
    `${API_URL}/inventory/products/${productId}/purchase`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  const result = await parseJsonSafe(response);
  if (!response.ok) {
    throw createApiError(response, result, "Failed to record stock purchase");
  }
  return result.data;
};

export const getInventoryTransformations = async () => {
  const response = await fetch(`${API_URL}/inventory/transformations`);
  const result = await parseJsonSafe(response);
  if (!response.ok) {
    throw createApiError(response, result, "Failed to fetch transformations");
  }
  return result.data;
};

export const getInventoryRecipes = async () => {
  const response = await fetch(`${API_URL}/inventory/recipes`);
  const result = await parseJsonSafe(response);
  if (!response.ok) {
    throw createApiError(response, result, "Failed to fetch recipes");
  }
  return result.data;
};

export const getInventoryPnl = async () => {
  const response = await fetch(`${API_URL}/inventory/pnl`);
  const result = await parseJsonSafe(response);
  if (!response.ok) {
    throw createApiError(response, result, "Failed to fetch inventory P&L");
  }
  return result.data;
};

export const getOverdueCustomers = async ({ page = 1, limit = 10 } = {}) => {
  const response = await fetch(
    `${API_URL}/customers/intelligence/overdue?page=${page}&limit=${limit}`
  );
  const result = await parseJsonSafe(response);
  if (!response.ok) {
    throw createApiError(response, result, "Failed to fetch overdue customers");
  }
  return result;
};

export const getHighestOutstandingCustomers = async ({
  page = 1,
  limit = 10,
} = {}) => {
  const response = await fetch(
    `${API_URL}/customers/intelligence/highest-outstanding?page=${page}&limit=${limit}`
  );
  const result = await parseJsonSafe(response);
  if (!response.ok) {
    throw createApiError(
      response,
      result,
      "Failed to fetch highest outstanding customers"
    );
  }
  return result;
};

export const getCustomerPatterns = async ({
  trend,
  page = 1,
  limit = 10,
} = {}) => {
  const query = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });
  if (trend) query.set("trend", trend);
  const response = await fetch(
    `${API_URL}/customers/intelligence/patterns?${query.toString()}`
  );
  const result = await parseJsonSafe(response);
  if (!response.ok) {
    throw createApiError(response, result, "Failed to fetch customer patterns");
  }
  return result;
};

export const getCustomerRisk = async (customerId) => {
  const response = await fetch(`${API_URL}/customers/${customerId}/risk`);
  const result = await parseJsonSafe(response);
  if (!response.ok) {
    throw createApiError(response, result, "Failed to fetch customer risk");
  }
  return result.data;
};

export const getReminderCandidates = async ({ upcomingDays = 3 } = {}) => {
  const response = await fetch(
    `${API_URL}/reminders/candidates?upcomingDays=${upcomingDays}`
  );
  const result = await parseJsonSafe(response);
  if (!response.ok) {
    throw createApiError(response, result, "Failed to fetch reminder candidates");
  }
  return result.data;
};

export const getReminders = async () => {
  const response = await fetch(`${API_URL}/reminders`);
  const result = await parseJsonSafe(response);
  if (!response.ok) {
    throw createApiError(response, result, "Failed to fetch reminders");
  }
  return result.data;
};

export const sendReminder = async ({ commitmentId, language }) => {
  const response = await fetch(`${API_URL}/reminders/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commitmentId, language }),
  });
  const result = await parseJsonSafe(response);
  if (!response.ok) {
    throw createApiError(response, result, "Failed to send reminder");
  }
  return result.data;
};

export const sendDueReminders = async ({ upcomingDays = 3 } = {}) => {
  const response = await fetch(`${API_URL}/reminders/send-due`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ upcomingDays }),
  });
  const result = await parseJsonSafe(response);
  if (!response.ok) {
    throw createApiError(response, result, "Failed to send due reminders");
  }
  return result;
};

export const getWhatsAppStatus = async () => {
  const response = await fetch(`${API_URL}/whatsapp/status`);
  const result = await parseJsonSafe(response);
  if (!response.ok) {
    throw createApiError(response, result, "Failed to fetch WhatsApp status");
  }
  return result.data;
};