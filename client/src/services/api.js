
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
export const createCommitment = async (commitmentData) => {
  const response = await fetch(`${API_URL}/commitments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commitmentData),
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.message || "Failed to save commitment");
  }

  return result.data;
};