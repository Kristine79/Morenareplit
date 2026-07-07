/**
 * Инициализация Prisma Client
 * Экспортируем единственный экземпляр клиента для всего приложения
 */

import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["query", "error"] : ["error"],
});

// Корректное завершение соединения при остановке процесса
async function shutdown(): Promise<void> {
  await prisma.$disconnect();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
