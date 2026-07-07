/**
 * Вспомогательные функции для форматирования сообщений
 */

import { Subscription } from "@prisma/client";

/**
 * Экранирование спецсимволов для MarkdownV2
 */
export function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\:]/g, "\\$&");
}

/**
 * Форматирование VPN-ключа в красивом блоке
 */
export function formatVpnKey(vpnKey: string): string {
  return `✅ *Ваш VPN\\-ключ Morena VPN:*\n\n\`\`\`\n${vpnKey}\n\`\`\`\n\n_Скопируйте ключ и вставьте в приложение_`;
}

/**
 * Форматирование даты истечения подписки
 */
export function formatDate(date: Date): string {
  return date.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/**
 * Проверка, активна ли подписка
 */
export function isActive(sub: Subscription): boolean {
  return new Date(sub.expiresAt) > new Date();
}

/**
 * Текстовый статус подписки
 */
export function subStatus(sub: Subscription): string {
  return isActive(sub) ? "🟢 Активна" : "🔴 Истекла";
}
