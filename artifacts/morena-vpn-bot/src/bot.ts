/**
 * Telegram-бот "Morena VPN"
 * Стек: grammY + Prisma (SQLite) + RoyaltyKey API + CryptoBot Pay
 *
 * Запуск бота: long polling или webhook-режим.
 */

import "dotenv/config";
import { bot } from "./botInstance.js";
import { cryptoBot } from "./cryptoBotApi.js";
import { startCronJobs } from "./cron.js";

async function setupMenuCommands(): Promise<void> {
  const commands = [
    { command: "docs", description: "📖 Документация и инструкция" },
  ];

  try {
    await bot.api.setMyCommands(commands);
    await bot.api.setChatMenuButton({ type: "commands" });
    console.log("✅ Команды меню зарегистрированы");
  } catch (err) {
    console.error("[bot] Ошибка регистрации команд:", err);
  }
}

const POLL_RETRY_DELAY_MS = 15_000; // wait 15 s then retry after a 409
const POLL_MAX_RETRIES    = 10;

async function main(): Promise<void> {
  console.log("🌙 Morena VPN Bot стартует...");

  // Сбрасываем webhook перед запуском (убирает конфликт 409 с другим long polling)
  try {
    await bot.api.deleteWebhook({ drop_pending_updates: true });
  } catch (err) {
    console.error("[bot] Ошибка сброса webhook:", err);
  }

  // Регистрируем команды меню
  await setupMenuCommands();

  // Запускаем CRON-задачи уведомлений
  startCronJobs(bot);

  const WEBHOOK_URL = process.env.WEBHOOK_URL;
  const CRYPTO_WEBHOOK_URL = process.env.CRYPTO_WEBHOOK_URL;

  // Webhook-режим: Telegram-обновления приходят на WEBHOOK_URL (обычно API-сервер).
  // Long polling нельзя запускать одновременно с webhook — это приводит к конфликту.
  if (WEBHOOK_URL) {
    try {
      const secretToken = process.env.WEBHOOK_SECRET;
      await bot.api.setWebhook(WEBHOOK_URL, {
        secret_token: secretToken,
      });
      console.log(`✅ Telegram Webhook зарегистрирован: ${WEBHOOK_URL}`);
      if (!secretToken) {
        console.warn("⚠️ WEBHOOK_SECRET не задан — подпись webhook не проверяется.");
      }
      console.log("🔸 Bot работает в webhook-режиме (long polling отключён).");
    } catch (err) {
      console.error("[bot] Ошибка регистрации Telegram webhook:", err);
      process.exit(1);
    }
  } else {
    // Polling-режим: бот сам опрашивает Telegram
    // Retry on 409 (another instance still holds the connection — Telegram releases it after ~30 s)
    console.log("🔄 Bot работает в режиме long polling.");
    for (let attempt = 1; attempt <= POLL_MAX_RETRIES; attempt++) {
      try {
        await bot.start({
          onStart: (info) => {
            console.log(`✅ Бот @${info.username} успешно запущен! (попытка ${attempt})`);
          },
        });
        break; // clean exit — stop retrying
      } catch (err: any) {
        const is409 = err?.error_code === 409 || String(err?.message ?? "").includes("409");
        if (is409 && attempt < POLL_MAX_RETRIES) {
          console.warn(`[bot] 409 конфликт — другой экземпляр ещё активен. Повтор через ${POLL_RETRY_DELAY_MS / 1000} с (попытка ${attempt}/${POLL_MAX_RETRIES})...`);
          await new Promise((r) => setTimeout(r, POLL_RETRY_DELAY_MS));
          // Re-create the bot connection before retrying
          try { await bot.api.deleteWebhook({ drop_pending_updates: false }); } catch {}
        } else {
          throw err;
        }
      }
    }
  }

  // CryptoBot webhook конфигурируется независимо от Telegram webhook/polling
  if (CRYPTO_WEBHOOK_URL) {
    try {
      await cryptoBot.setWebhook(CRYPTO_WEBHOOK_URL);
      console.log(`✅ CryptoBot Webhook зарегистрирован: ${CRYPTO_WEBHOOK_URL}`);
    } catch (err) {
      console.error("[bot] Ошибка регистрации CryptoBot webhook:", err);
    }
  }

  // В webhook-режиме процесс должен оставаться живым, чтобы CRON и другие фоновые задачи продолжали работу.
  if (WEBHOOK_URL) {
    await new Promise(() => {});
  }
}

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n🛑 Остановка бота...");
  await bot.stop();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  console.log("\n🛑 Остановка бота...");
  await bot.stop();
  process.exit(0);
});

main().catch((err) => {
  console.error("Критическая ошибка при запуске бота:", err);
  process.exit(1);
});
