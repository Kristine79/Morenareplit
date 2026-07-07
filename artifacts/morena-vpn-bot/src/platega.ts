/**
 * Platega.io Payment API Client
 * Docs: https://docs.platega.io/
 *
 * Auth: X-MerchantId + X-Secret headers
 * Base URL: https://app.platega.io
 */

import axios, { AxiosError } from "axios";

const BASE_URL = "https://app.platega.io";

export const PLATEGA_MERCHANT_ID = process.env.PLATEGA_MERCHANT_ID;
export const PLATEGA_SECRET = process.env.PLATEGA_SECRET;

// Payment method IDs per Platega docs
export const PLATEGA_METHOD = {
  SBP: 2,        // СБП (QR-код) + Sberpay
  ERIP: 3,       // ЕРИП (Беларусь)
  CARD: 11,      // Карточный эквайринг
  INTERNATIONAL: 12, // Международная оплата
  CRYPTO: 13,    // Криптовалюта
} as const;

export type PlategalPaymentMethod = typeof PLATEGA_METHOD[keyof typeof PLATEGA_METHOD];

export type PlategalStatus = "PENDING" | "CONFIRMED" | "CANCELED" | "CHARGEBACKED";

export interface PlategalInvoice {
  transactionId: string;
  status: PlategalStatus;
  url: string;
  expiresIn: string;
  rate?: number;
  paymentMethod?: string;
}

export interface PlategalStatusResponse {
  id: string;
  status: PlategalStatus;
  paymentDetails: {
    amount: number;
    currency: string;
    paymentMethod?: string;
    comission?: number;
    comissionUsdt?: number;
    amountUsdt?: number;
    qr?: string;
    expiresIn?: string;
  };
}

export interface PlategalBalance {
  currency: string;
  amount: number;
}

export interface PlategalCallbackPayload {
  id: string;
  amount: number;
  currency: string;
  status: "CONFIRMED" | "CANCELED";
  paymentMethod?: number;
  payload: string;
}

function authHeaders() {
  return {
    "X-MerchantId": PLATEGA_MERCHANT_ID ?? "",
    "X-Secret": PLATEGA_SECRET ?? "",
    "Content-Type": "application/json",
  };
}

function logError(tag: string, err: unknown): void {
  if (err instanceof AxiosError) {
    console.error(`[platega][${tag}] HTTP ${err.response?.status}:`, JSON.stringify(err.response?.data ?? err.message));
  } else {
    console.error(`[platega][${tag}]`, err);
  }
}

export const platega = {
  /** Returns true if PLATEGA_MERCHANT_ID and PLATEGA_SECRET are both set */
  isConfigured(): boolean {
    return Boolean(PLATEGA_MERCHANT_ID && PLATEGA_SECRET);
  },

  /**
   * Create a payment transaction.
   * @param amountRub  Amount in RUB (integer)
   * @param description  Human-readable description
   * @param payload  Internal payload string (up to 255 chars) — passed back in callback
   * @param method  Optional payment method ID (see PLATEGA_METHOD). If omitted, user selects on payment page.
   * @param metadata  Optional anti-fraud metadata
   */
  async createPayment(
    amountRub: number,
    description: string,
    payload: string,
    method?: PlategalPaymentMethod,
    metadata?: { userId: string; userName: string }
  ): Promise<PlategalInvoice> {
    const successUrl = process.env.PLATEGA_SUCCESS_URL ?? "https://t.me/morenavpn_bot";
    const failUrl    = process.env.PLATEGA_FAIL_URL    ?? "https://t.me/morenavpn_bot";

    const body: Record<string, unknown> = {
      paymentDetails: { amount: Math.round(amountRub), currency: "RUB" },
      description,
      return:    successUrl,
      failedUrl: failUrl,
      payload,
      ...(metadata ? { metadata } : {}),
    };

    // v2 endpoint: no method (user picks on pay page)
    // v1 endpoint: method specified
    const endpoint = method == null
      ? `${BASE_URL}/v2/transaction/process`
      : `${BASE_URL}/transaction/process`;

    if (method != null) {
      body.paymentMethod = method;
    }

    const res = await axios.post<PlategalInvoice>(endpoint, body, { headers: authHeaders() });
    return res.data;
  },

  /**
   * Check the status of an existing transaction.
   */
  async checkStatus(transactionId: string): Promise<PlategalStatusResponse> {
    const res = await axios.get<PlategalStatusResponse>(
      `${BASE_URL}/transaction/${transactionId}`,
      { headers: authHeaders() }
    );
    return res.data;
  },

  /**
   * Get all balances for this merchant account.
   */
  async getBalances(): Promise<PlategalBalance[]> {
    try {
      const res = await axios.get<PlategalBalance[]>(
        `${BASE_URL}/transaction/balance`,
        { headers: authHeaders() }
      );
      return Array.isArray(res.data) ? res.data : [res.data as unknown as PlategalBalance];
    } catch (err) {
      logError("getBalances", err);
      throw err;
    }
  },

  /**
   * Check if a transaction can be cancelled.
   */
  async canCancel(transactionId: string): Promise<boolean> {
    try {
      const res = await axios.get<{ canCancel: boolean }>(
        `${BASE_URL}/transaction/${transactionId}/can-cancel`,
        { headers: authHeaders() }
      );
      return res.data?.canCancel ?? false;
    } catch {
      return false;
    }
  },

  /**
   * Cancel a pending transaction.
   */
  async cancelTransaction(transactionId: string): Promise<void> {
    await axios.post(
      `${BASE_URL}/transaction/${transactionId}/cancel`,
      {},
      { headers: authHeaders() }
    );
  },

  /**
   * Export transactions as JSON for a date range.
   * @param from  ISO date string (e.g. "2026-01-01T00:00:00.000Z")
   * @param to    ISO date string
   * @param statuses  Optional array of status IDs to filter
   * @param paymentMethods  Optional array of method IDs to filter
   */
  async exportTransactions(params: {
    from: string;
    to: string;
    statuses?: string[];
    paymentMethods?: string[];
    timeZoneId?: string;
  }): Promise<unknown[]> {
    const res = await axios.post<unknown[]>(
      `${BASE_URL}/transaction/export/json`,
      {
        from:           params.from,
        to:             params.to,
        statuses:       params.statuses,
        paymentMethods: params.paymentMethods,
        timeZoneId:     params.timeZoneId ?? "UTC",
      },
      { headers: authHeaders() }
    );
    return Array.isArray(res.data) ? res.data : [];
  },

  /**
   * Get conversions (currency conversion history).
   */
  async getConversions(): Promise<unknown[]> {
    try {
      const res = await axios.get(`${BASE_URL}/transaction/conversions`, { headers: authHeaders() });
      return Array.isArray(res.data) ? res.data : [];
    } catch (err) {
      logError("getConversions", err);
      throw err;
    }
  },

  /**
   * Get saved cards for this merchant.
   */
  async getSavedCards(): Promise<unknown[]> {
    try {
      const res = await axios.get(`${BASE_URL}/transaction/saved-cards`, { headers: authHeaders() });
      return Array.isArray(res.data) ? res.data : [];
    } catch (err) {
      logError("getSavedCards", err);
      throw err;
    }
  },

  /**
   * Verify an incoming callback came from Platega by checking the X-MerchantId and X-Secret headers.
   */
  verifyCallback(merchantId: string, secret: string): boolean {
    if (!PLATEGA_MERCHANT_ID || !PLATEGA_SECRET) return false;
    return merchantId === PLATEGA_MERCHANT_ID && secret === PLATEGA_SECRET;
  },
};
