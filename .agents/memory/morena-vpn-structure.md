---
name: Morena VPN project structure
description: Architecture, build quirks, and security decisions for the Morena VPN bot + admin panel project.
---

## Architecture

- **artifacts/morena-vpn-bot/** — grammY Telegram bot, Prisma + SQLite (`prisma/morena.db`). Runs with `tsx watch src/bot.ts`. Long-polling in dev; webhook when `WEBHOOK_URL` is set. DB generated with `pnpm exec prisma generate` inside this dir.
- **artifacts/api-server/** — Express 5, reads the same SQLite DB via `better-sqlite3` (NOT Prisma/drizzle). Auth: express-session with `SESSION_SECRET`; password login or Telegram Widget HMAC.
- **artifacts/admin-panel/** — React + Vite, preview at `/admin-panel/`. Dev proxy: `/api` → `localhost:80`.
- **lib/db** — PostgreSQL/Drizzle lib that exists in the workspace but is NOT used by any of these artifacts.

## Build quirks

- `@prisma/client` must be generated before api-server can start: `cd artifacts/morena-vpn-bot && pnpm exec prisma generate`.
- `grammy` and `dotenv` must be in the esbuild `external` list in `artifacts/api-server/build.mjs` — grammy has a native platform module that can't be bundled.
- `pnpm-workspace.yaml` `onlyBuiltDependencies` must include `@prisma/client`, `@prisma/engines`, `better-sqlite3`, `prisma`.

## Security fixes applied

- `/auth/dev-login` gated to `NODE_ENV === 'development'` and requires `ADMIN_TELEGRAM_ID` match.
- Webhook route (`/bot/webhook`) now rejects ALL requests when `WEBHOOK_SECRET` is unset (was previously allowing all through).
- `check_payment` callback verifies `payment.telegramUserId === ctx.from.id` before granting access.
- `isActive` in admin subscriptions route uses `new Date(s.expiresAt).getTime() > Date.now()` (was broken `Number(ISO_string)` → NaN).

## Required secrets

SESSION_SECRET, BOT_TOKEN, ROYALTYKEY_API_KEY, CRYPTO_BOT_TOKEN, ADMIN_TELEGRAM_ID, ADMIN_PASSWORD. Optional: BOT_USERNAME (defaults to "morenavpn_bot"), WEBHOOK_SECRET, USDT_RUB_RATE (default 85).

## Why: design decisions

- The api-server reads the bot's SQLite DB directly via better-sqlite3 (not through Prisma) to avoid bundling Prisma in the esbuild bundle and to support read-only admin queries without a separate DB process.
- The bot uses long-polling by default so it works without a public URL in dev. The 409 conflict error on bot restart is transient — Telegram drops the old connection within seconds.
