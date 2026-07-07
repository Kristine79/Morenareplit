import "dotenv/config";
import axios, { AxiosError } from "axios";

const BASE_URL = "https://api.royaltykey.ru";

export interface RoyaltyKeyUser {
  uuid: string;
  username: string;
  subscription_url: string;
}

export interface RoyaltyKeyUserDetails extends RoyaltyKeyUser {
  status: "ACTIVE" | "EXPIRED" | "DISABLED";
  expire_at: string;
  created_at: string;
  traffic: {
    used_bytes: number;
    lifetime_used_bytes: number;
  };
}

export interface RoyaltyKeySubscriptionResult {
  success: boolean;
  days_added: number;
  price: number;
  new_balance: number;
}

export interface RoyaltyKeyBalance {
  balance: number;
  subscriptions: Record<string, number>;
  prices: Record<string, { base: number; current: number }>;
}

function handleApiError(error: unknown): string {
  if (error instanceof AxiosError) {
    if (error.response) {
      const status = error.response.status;
      if (status === 400) return "400 Bad Request";
      if (status === 402) return "402 Payment Required";
      if (status === 403) return "403 Forbidden: API ключ не найден или деактивирован";
      if (status === 404) return "404 Not Found";
      if (status === 409) return "409 Conflict";
      if (status >= 500) return `${status} Server Error`;
      return `Ошибка ${status}`;
    }
    if (error.code === 'ECONNABORTED') return "Таймаут запроса";
    if (error.code === 'ENOTFOUND') return "DNS ошибка";
    if (error.code === 'ECONNREFUSED') return "Connection refused";
    if (error.code === 'ERR_BAD_REQUEST') return "Bad request";
    return "Upstream API error";
  }
  return "Internal error";
}

export class RoyaltyKeyApi {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly proxyUrl: string | undefined;

  constructor() {
    const apiKey = process.env.ROYALTYKEY_API_KEY;
    if (!apiKey) throw new Error("ROYALTYKEY_API_KEY не задан в переменных окружения");
    this.apiKey = apiKey;
    this.baseUrl = `${BASE_URL}/${apiKey}`;
    this.timeout = parseInt(process.env.ROYALTYKEY_TIMEOUT ?? "10000");

    const proxyEnv = process.env.ROYALTYKEY_PROXY;
    this.proxyUrl = proxyEnv && proxyEnv.startsWith("http") ? proxyEnv : undefined;
  }

  private buildProxyConfig() {
    if (!this.proxyUrl) return false;
    const url = new URL(this.proxyUrl);
    return {
      host: url.hostname,
      port: parseInt(url.port) || 80,
      protocol: url.protocol.replace(":", ""),
    };
  }

  private async request<T>(method: "get" | "post" | "delete", path: string, data?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const config: Record<string, unknown> = {
      timeout: this.timeout,
    };

    const proxyConfig = this.buildProxyConfig();
    if (proxyConfig) {
      config.proxy = proxyConfig;
    }

    try {
      let response;
      if (method === "get") {
        response = await axios.get(url, config);
      } else if (method === "post") {
        response = await axios.post(url, data ?? {}, config);
      } else {
        response = await axios.delete(url, config);
      }
      return response.data as T;
    } catch (error) {
      if (error instanceof AxiosError) {
        error.config = undefined;
      }
      throw new Error(`[RoyaltyKey] ${handleApiError(error)}`);
    }
  }

  async createUser(): Promise<RoyaltyKeyUser> {
    const user = await this.request<RoyaltyKeyUser>("post", "/users");
    return {
      ...user,
      subscription_url: user.subscription_url.replace(/w\.royaltykey\.ru/gi, "morenagate.pro"),
    };
  }

  async addSubscription(
    vpnUuid: string,
    days: number,
    tariff: "regular" | "lte"
  ): Promise<RoyaltyKeySubscriptionResult> {
    return this.request<RoyaltyKeySubscriptionResult>("post", `/users/${vpnUuid}/subscription`, { days, tariff });
  }

  async getUser(vpnUuid: string): Promise<RoyaltyKeyUserDetails> {
    return this.request<RoyaltyKeyUserDetails>("get", `/users/${vpnUuid}`);
  }

  async listUsers(): Promise<{ users: RoyaltyKeyUserDetails[]; total: number }> {
    return this.request<{ users: RoyaltyKeyUserDetails[]; total: number }>("get", "/users");
  }

  async deleteUser(vpnUuid: string): Promise<{ success: boolean; deleted_uuid: string }> {
    return this.request<{ success: boolean; deleted_uuid: string }>("delete", `/users/${vpnUuid}`);
  }

  async getBalance(): Promise<RoyaltyKeyBalance> {
    return this.request<RoyaltyKeyBalance>("get", "/balance");
  }

  async buyTraffic(vpnUuid: string, gb: number): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>("post", `/users/${vpnUuid}/buy-traffic?gb=${gb}`);
  }
}

export const royaltyKey = new RoyaltyKeyApi();
