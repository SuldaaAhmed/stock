# Stock Management System — Backend API (v1.1)

Backend for the single-company, single-Admin Stock Management System, built to
*Backend Requirements Documentation v1.1*.

| | |
|---|---|
| Runtime | Node.js 22 + TypeScript (strict) |
| HTTP | Express 5, Zod 4 validation, OpenAPI 3.1 / Swagger UI |
| Database | PostgreSQL (`pg`), SQL migrations, append-only ledger enforced by triggers |
| PDF | PDFKit (receipts and report exports) |
| Tests | `node:test` + supertest against a real PostgreSQL (38 integration tests) |

> The specification names ASP.NET Core / EF Core. This implementation follows the same API
> contract, data rules and security model in Node.js + PostgreSQL. Passwords are hashed in the
> ASP.NET Core Identity V3 format (PBKDF2-HMAC-SHA512, 100k iterations), so the hashes stay compatible
> if the backend is ever ported back to .NET Identity.

---

## 1. Quick start (development)

```bash
cd backend
npm install
cp .env.example .env          # adjust values as needed

# Terminal 1 – local PostgreSQL 18 (embedded binaries, data in backend/.pgdata, port 5433)
npm run dev:db

# Terminal 2 – API on http://localhost:5000 (migrates + seeds on startup)
npm run dev
```

- Swagger UI: <http://localhost:5000/api/docs> (OpenAPI JSON at `/api/openapi.json`)
- Health: <http://localhost:5000/health>
- First login: `ADMIN_USERNAME` / `ADMIN_PASSWORD` from `.env` (default `admin` / `ChangeMe!2026`).
  These are used **only** when no Admin exists yet. Change the password for any real deployment.

If you already have PostgreSQL, skip `npm run dev:db` and set `DATABASE_URL`.

The frontend (Next.js) calls relative `/api/v1/...` URLs. Its dev server proxies these to this API,
so the browser sees one origin and the `SameSite=Lax` cookies work.

## 2. Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | API with hot reload (tsx watch) |
| `npm run dev:db` | Local embedded PostgreSQL on port 5433 |
| `npm run build` / `npm start` | Compile to `dist/` and run in production |
| `npm run migrate` | Apply pending SQL migrations only |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Integration tests (starts a throwaway PostgreSQL, or uses `TEST_DATABASE_URL`, **which is wiped**) |
| `npm run admin:reset-password -- --username admin --password '<new>' [--rename <user>]` | Server-side Admin password reset; revokes all sessions and is audited |
| `npm run backup:decrypt -- <file.stkbak> <out.json>` | Decrypt a downloaded backup with `BACKUP_ENCRYPTION_KEY` |

## 3. Configuration (`.env`)

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | `development` | `production` enables strict startup checks |
| `PORT` / `HOST` | `5000` / `0.0.0.0` | |
| `DATABASE_URL` | `postgres://stock:stock@127.0.0.1:5433/stock` | |
| `SESSION_SECRET`, `CSRF_SECRET` | dev values | **Required** (≥ 32 chars) in production |
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated allowlist (credentials enabled) |
| `COOKIE_SAMESITE` / `COOKIE_SECURE` | `Lax` / `false` | `COOKIE_SECURE=true` is enforced in production |
| `SESSION_SLIDING_MINUTES` / `SESSION_ABSOLUTE_HOURS` | `60` / `12` | Idle timeout and absolute lifetime |
| `CSRF_ENABLED` | `true` | |
| `LOGIN_MAX_FREE_ATTEMPTS` / `LOGIN_MAX_DELAY_SECONDS` | `5` / `300` | Progressive delay (HTTP 429 + `Retry-After`), never a lockout |
| `SWAGGER_ENABLED` | `true` | Open in development; Admin-only elsewhere |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | `admin` / `ChangeMe!2026` | Bootstrap only |
| `STORAGE_DIR` | `./storage` | Logo files and backups (keep outside the web root) |
| `LOGO_MAX_BYTES` | `2097152` | |
| `BACKUP_ENCRYPTION_KEY` | zeros | 64 hex chars (AES-256-GCM). A real key is **required** in production. Keep a copy outside the server, because backups cannot be restored without it |
| `BACKUP_SCHEDULE_ENABLED` | `true` | Daily automatic backup at 00:00 Africa/Nairobi |
| `RECONCILIATION_INTERVAL_MINUTES` | `60` | Ledger-vs-balance reconciliation job |
| `IDEMPOTENCY_RETENTION_HOURS` | `24` | |
| `LOG_LEVEL` | `info` | pino structured logs (passwords, cookies and tokens are redacted) |

## 4. API conventions

- **Base path** `/api/v1`. JSON camelCase. Success responses are `{ data, meta?, requestId }`.
- **Errors** follow ProblemDetails: `{ type, title, status, requestId, errors: [{ field, message }] }`
  - `400` validation; `401` not logged in / session expired; `403` CSRF failure
  - `404` not found; `409` concurrency / duplicate / idempotency-key reuse
  - `422` business rule (e.g. `INSUFFICIENT_STOCK`, `OVER_DELIVERY`, `OVER_RETURN`, `PRODUCT_INACTIVE`); `429` login throttle
- **Auth**: `POST /auth/login` sets the HttpOnly session cookie `stock.sid`.
  - Sessions are stored server-side as an HMAC hash. Expiry is 60-minute sliding with a 12-hour absolute limit. A server-side password reset or a backup restore revokes every session.
- **CSRF**: `GET /auth/csrf` returns `{ data: { token } }` and sets the `stock.csrf` cookie. Send the token as the
  `X-CSRF-TOKEN` header on every POST/PUT/PATCH/DELETE.
- **Idempotency**: every posting operation needs an `Idempotency-Key` header (UUID).
  - Posting operations: stock in/out, deliveries, returns, adjustments, damaged actions, corrections, product/customer/order create, and backups.
  - Replaying the same key returns the original response. Reusing a key with a different body returns `409 IDEMPOTENCY_KEY_REUSED`.
- **Optimistic concurrency**: GETs for products, customers, orders and company settings return an `ETag`. PATCH requires
  `If-Match` (or `rowVersion` in the body). A stale version returns `409`.
- **Lists**: `page`, `pageSize` (10/25/50/100), `search`, `sort`, `order`, and `period=day|week|month|custom`
  with `date` / `from` / `to`. Business dates are `YYYY-MM-DD` on the **Africa/Nairobi** calendar, and weeks start on Monday.
  Timestamps are UTC ISO-8601.
- **Units**: quantities are whole **BOX** values (zero and decimals are rejected). Money is **KES** with up to two decimals.

### Endpoints

| Area | Endpoints |
|---|---|
| Auth | `GET /auth/csrf`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` |
| Dashboard / Search | `GET /dashboard/summary`, `GET /search?q=` (products, customers, every document number) |
| Products | `GET/POST /products`, `GET/PATCH /products/{id}`, `GET /products/{id}/history?section=movements\|edits\|prices\|opening-stock-corrections` (aliases: `/movements`, `/edit-history`, `/price-history`), `POST /products/{id}/opening-stock-corrections` |
| Stock In | `GET/POST /stock-ins`, `GET /stock-ins/{id}`, `POST /stock-ins/{id}/corrections` |
| Stock Out | `GET/POST /stock-outs` (Sample, Gift, WarehouseTransfer), `GET /stock-outs/{id}`, `POST /stock-outs/{id}/corrections`, `GET /transfers`, `GET /transfers/{id}` |
| Customers | `GET/POST /customers`, `GET/PATCH /customers/{id}`, `GET /customers/{id}/history` |
| Orders | `GET/POST /orders`, `GET/PATCH /orders/{id}`, `GET/POST /orders/{id}/deliveries` |
| Returns | `GET/POST /returns`, `GET /returns/{id}`, `POST /returns/{id}/corrections` |
| Adjustments | `GET/POST /adjustments`, `GET /adjustments/{id}`, `POST /adjustments/{id}/corrections` |
| Damaged stock | `GET/POST /damaged-stock/actions` (MarkAsGood / Remove), `GET /damaged-stock/actions/{id}` |
| Receipts | `GET /receipts/{id}`, `GET /receipts/{id}/pdf?disposition=inline\|attachment` |
| Reports | `GET /reports/{type}`, `GET /reports/{type}/export/pdf`. Types: `current-stock`, `stock-in`, `stock-out`, `customer-orders`, `returns`, `adjustments`, `sample-gift`, `warehouse-transfer`, `low-stock`, `damaged-stock` |
| Settings | `GET/PATCH /settings/company`, `GET/PUT/DELETE /settings/company/logo` (multipart `file`, PNG/JPEG), `GET/PATCH /settings/preferences` |
| Audit | `GET /audit-logs`, `GET/PATCH/DELETE /audit-logs/{id}`, `GET /audit-log-corrections` |
| Backups | `GET/POST /backups`, `GET /backups/{id}`, `GET /backups/{id}/download`, `POST /backups/{id}/restore` with body `{ "confirm": true, "confirmationText": "RESTORE" }` |
| Health | `GET /health` (anonymous: database, maintenance flag, last reconciliation) |

## 5. Business rules implemented

- **Stock formula** (§5), computed from the append-only `stock_movements` ledger:
  - `Available = opening + stockIn + goodReturns + adjustmentIn + markedAsGood − stockOut − adjustmentOut`
  - `Damaged = damagedReturns − markedAsGood − removedFromDamaged`
  - Product balances are a cached projection, updated in the same transaction with row locks (`SELECT … FOR UPDATE`, products locked in id order to avoid deadlocks).
  - A CHECK constraint and the service layer both keep balances from going negative.
- **Numbering**: `SIN-`, `SOUT-`, `ORD-`, `RET-`, `ADJ-`, `TRF-`, `REC-`, zero-padded to 4 digits.
  - Numbers are allocated from locked counters *inside* the posting transaction, so failed posts never consume a number and concurrent posts never duplicate one.
- **Receipts** are immutable snapshots: company details, logo, lines and admin are captured at issue time.
  - Stock In, Stock Out, Returns, Adjustments and Damaged actions issue a receipt when posted. Orders issue one only when they first become Completed.
- **Orders**: no stock reservation. Status is derived: Pending → Partially Completed → Completed. There is no cancel.
  - Each delivery creates a `CustomerDelivery` Stock Out. Over-delivery is rejected.
  - Edit rules depend on status: customer and date lock after the first delivery, and completed orders are read-only.
- **Returns**: against an order (max = delivered − previously returned) or direct (registered customer required).
  - Good returns go to Available stock; Damaged returns go to Damaged stock. A reason is required. Inactive products are allowed.
- **Inactive products** (§4.2): blocked for new Stock In, Stock Out, orders and adjustments. Still allowed for returns, damaged actions, history and reports.
- **Corrections**: the original stays in the database and is marked *Superseded*.
  - A new version is posted with the same number and `version + 1`. Reversal and restated ledger entries are posted atomically.
  - A new receipt is issued and the old one is marked superseded.
  - The transaction type cannot change. Deliveries are corrected through returns, never by editing the delivery.
- **Audit trail**: every login (success/failure), posting, edit, correction, setting change, backup and restore is logged with before/after values.
  - Audit entries can be edited (description/note) or soft-deleted (reason required). Each change writes an immutable `audit_log_corrections` record.
- **Append-only guarantees**: database triggers reject UPDATE/DELETE on the ledger, receipt lines and correction trails.
- **Backups** (§17): full logical dump of every table plus logo files.
  - Files are gzip-compressed and AES-256-GCM encrypted, with a SHA-256 checksum, schema version and `STKBK1` header.
  - Backups are kept forever. Manual or automatic (daily 00:00 Africa/Nairobi), with overlap prevented by a PostgreSQL advisory lock.
  - **Restore** steps:
    1. Verify the checksum and schema version.
    2. Take a mandatory pre-restore backup.
    3. Enter maintenance mode.
    4. Truncate and reload in a single transaction.
    5. Reset sequences.
    6. Invalidate all sessions.
    7. Restore logo files.
    8. Run reconciliation.
- **Reconciliation**: on startup, on a schedule, and after restore, recomputes balances from the ledger and records any mismatch. `/health` reports it.

## 6. Project layout

```
src/
  app.ts, server.ts, config.ts, logger.ts
  db/            pool, migration runner, seed, migrations/*.sql
  http/          route registry → Express + OpenAPI, validation, errors, middleware (auth, csrf, throttle, maintenance)
  routes/        products, transactions (stock in/out, returns, adjustments, transfers, damaged), orders, system
  services/      domain services (ledger, numbering, receipts, pdf, reports, search, backups, scheduler, …)
scripts/         dev-db, reset-admin-password, decrypt-backup, copy-assets
tests/           integration test suite + harness
```

## 7. Production checklist

1. Set `NODE_ENV=production` and strong `SESSION_SECRET` / `CSRF_SECRET`.
2. Set a real 64-hex `BACKUP_ENCRYPTION_KEY` and store a copy off-server.
3. Serve over HTTPS with `COOKIE_SECURE=true`. Ideally put the frontend and API on the same site behind one reverse proxy.
4. Set `CORS_ORIGINS` to the exact frontend origin.
5. Put `STORAGE_DIR` on persistent, backed-up storage, and periodically download backups off-site.
6. Log in with the bootstrap Admin and change the password immediately.
