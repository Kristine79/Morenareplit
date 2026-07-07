/**
 * Модуль для работы с CryptoBot Pay API
 * Документация: https://help.crypt.bot/crypto-pay-api
 */

import "dotenv/config";
import axios from "axios";

const MAINNET_URL = "https://pay.crypt.bot/api";
const TESTNET_URL = "https://testnet-pay.crypt.bot/api";

// Курс USDT к RUB (1 USDT = X RUB)
export const USDT_RUB_RATE: number = parseFloat(process.env.USDT_RUB_RATE ?? "85");

interface CryptoBotInvoice {
  invoice_id: number;
  pay_url: string;
  status: "active" | "paid" | "expired" | "cancelled";
  amount: string;
  asset?: string;
  currency_type?: string;
}

interface CryptoBotResponse<T> {
  ok: boolean;
  result: T;
  error?: { code: number; name: string };
}

export class CryptoBotApi {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor() {
    const token = process.env.CRYPTO_BOT_TOKEN;
    if (!token) throw new Error("CRYPTO_BOT_TOKEN не задан");
    const useTestnet = process.env.CRYPTO_BOT_TESTNET === "true";
    this.baseUrl = useTestnet ? TESTNET_URL : MAINNET_URL;
    this.headers = {
      "Crypto-Pay-API-Token": token,
      "Content-Type": "application/json",
    };
    this.axiosConfig = { headers: this.headers, timeout: 10000, validateStatus: () => true };
  }

  private readonly axiosConfig: { headers: Record<string, string>; timeout: number; validateStatus: () => boolean };

  async createCryptoInvoice(amountRub: number, payload: string): Promise<{ invoice_id: number; status: string; pay_url: string }> {
    const amountUsdt = (amountRub / USDT_RUB_RATE).toFixed(2);
    const response = await axios.post<CryptoBotResponse<CryptoBotInvoice>>(
      `${this.baseUrl}/createInvoice`,
      {
        asset: "USDT",
        amount: amountUsdt,
        payload,
        description: "Оплата безопасного сетевого шлюза Morena VPN",
      },
      this.axiosConfig
    );

    if (!response.data.ok) {
      const errDetail = JSON.stringify(response.data.error);
      console.error(`[CryptoBot] createInvoice error: ${errDetail}, full response:`, JSON.stringify(response.data));
      throw new Error(`CryptoBot API error: ${errDetail}`);
    }

    const inv = response.data.result;
    return {
      invoice_id: inv.invoice_id,
      status: inv.status,
      pay_url: inv.pay_url,
    };
  }

  async createRubInvoice(amountRub: number, payload: string): Promise<{ invoice_id: number; status: string; pay_url: string }> {
    return this.createCryptoInvoice(amountRub, payload);
  }

  async getInvoiceStatus(invoiceId: number): Promise<string> {
    const response = await axios.get<CryptoBotResponse<{ items: CryptoBotInvoice[] }>>(
      `${this.baseUrl}/getInvoices`,
      {
        params: { invoice_ids: invoiceId.toString() },
        ...this.axiosConfig,
      }
    );

    if (!response.data.ok || !response.data.result.items.length) {
      throw new Error(`CryptoBot: инвойс ${invoiceId} не найден`);
    }

    return response.data.result.items[0].status;
  }

  async setWebhook(webhookUrl: string): Promise<{ ok: boolean }> {
    const response = await axios.post<CryptoBotResponse<{ ok: boolean }>>(
      `${this.baseUrl}/setWebhooks`,
      { url: webhookUrl },
      this.axiosConfig
    );

    if (!response.data.ok) {
      throw new Error(`CryptoBot setWebhook error: ${JSON.stringify(response.data.error)}`);
    }

    console.log(`[CryptoBot] Webhook установлен: ${webhookUrl}`);
    return response.data.result;
  }

  async deleteWebhook(): Promise<{ ok: boolean }> {
    const response = await axios.post<CryptoBotResponse<{ ok: boolean }>>(
      `${this.baseUrl}/setWebhooks`,
      { url: "" },
      this.axiosConfig
    );

    if (!response.data.ok) {
      throw new Error(`CryptoBot deleteWebhook error: ${JSON.stringify(response.data.error)}`);
    }

    console.log(`[CryptoBot] Webhook удалён`);
    return response.data.result;
  }
}

export const cryptoBot = new CryptoBotApi();
