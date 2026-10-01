// ==========================================
// STEADFAST COURIER API CLIENT in Node.js
// ==========================================
// Docs (community-documented, Steadfast doesn't publish a public portal):
// Base URL: https://portal.steadfast.com.bd/api/v1
// Auth headers: Api-Key / Secret-Key (from your Steadfast Merchant Panel)
//
// Credentials are read from .env (STEADFAST_BASE_URL / STEADFAST_API_KEY /
// STEADFAST_SECRET_KEY) — never hardcode them here.

const BASE_URL = process.env.STEADFAST_BASE_URL || "https://portal.packzy.com/api/v1";
const API_KEY = process.env.STEADFAST_API_KEY;
const SECRET_KEY = process.env.STEADFAST_SECRET_KEY;

function authHeaders() {
  return {
    "Content-Type": "application/json",
    "Api-Key": API_KEY,
    "Secret-Key": SECRET_KEY,
  };
}

async function request(path, options = {}) {
  if (!API_KEY || !SECRET_KEY) {
    throw new Error("Steadfast API credentials are missing. Set STEADFAST_API_KEY and STEADFAST_SECRET_KEY in .env");
  }

  const res = await fetch(BASE_URL + path, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) },
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const message = data?.message || `Steadfast API error (HTTP ${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    err.response = data;
    throw err;
  }

  return data;
}

/**
 * Creates a single consignment/order with Steadfast.
 * @param {Object} order
 * @param {string} order.invoice - Your own unique order/invoice number (e.g. Sale.saleId)
 * @param {string} order.recipient_name
 * @param {string} order.recipient_phone
 * @param {string} order.recipient_address
 * @param {number} order.cod_amount - Amount to collect on delivery (0 if fully prepaid)
 * @param {string} [order.note]
 * @param {string} [order.item_description]
 */
async function createOrder(order) {
  return request("/create_order", {
    method: "POST",
    body: JSON.stringify({
      invoice: order.invoice,
      recipient_name: order.recipient_name,
      recipient_phone: order.recipient_phone,
      recipient_address: order.recipient_address,
      cod_amount: order.cod_amount,
      note: order.note || "",
      item_description: order.item_description || "",
    }),
  });
}

/** Creates multiple consignments in one call (array of order objects, same shape as createOrder). */
async function createBulkOrder(orders) {
  return request("/create_order/bulk-order", {
    method: "POST",
    body: JSON.stringify({ data: orders }),
  });
}

async function statusByConsignmentId(cid) {
  return request(`/status_by_cid/${encodeURIComponent(cid)}`, { method: "GET" });
}

async function statusByInvoice(invoice) {
  return request(`/status_by_invoice/${encodeURIComponent(invoice)}`, { method: "GET" });
}

async function statusByTrackingCode(trackingCode) {
  return request(`/status_by_trackingcode/${encodeURIComponent(trackingCode)}`, { method: "GET" });
}

async function getBalance() {
  return request("/get_balance", { method: "GET" });
}

function getTrackingUrl(trackingCode) {
  return `https://steadfast.com.bd/t/${trackingCode}`;
}

module.exports = {
  createOrder,
  createBulkOrder,
  statusByConsignmentId,
  statusByInvoice,
  statusByTrackingCode,
  getBalance,
  getTrackingUrl,
};