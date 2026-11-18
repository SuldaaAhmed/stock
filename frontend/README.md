# Stock Management — Frontend

Next.js 14 (App Router) + React 18 + TypeScript + Tailwind CSS admin web app for the Stock Management backend
(`../backend`). It is built to `Frontend_Requirements_Documentation.md`: English UI, online-only, Light/Dark theme,
KES currency, BOX unit.

## Run

```bash
# 1. Backend (see ../backend/README.md): database + API on port 5000
cd ../backend && npx tsx scripts/dev-db.ts      # dev PostgreSQL on 5433 (or use your own DATABASE_URL)
cd ../backend && npm run dev                     # API on http://localhost:5000

# 2. Frontend
cd frontend
npm install
npm run dev        # http://localhost:3000  (production: npm run build && npm start)
```

Default login: `admin` / `ChangeMe!2026` (change it on the server).

`BACKEND_URL` (default `http://127.0.0.1:5000`) sets where Next.js proxies `/api/*` and `/health`. The browser only
calls **relative** `/api/v1/...` URLs, so the session and CSRF cookies are same-origin and no CORS setup is needed.

## How it connects to the backend

| Concern | Implementation (`src/lib/api.ts`) |
|---|---|
| Auth | HttpOnly session cookie only — nothing is stored in localStorage. `GET /auth/me` restores the session; a 401 redirects to `/login?reason=expired`. |
| CSRF | `GET /auth/csrf` token is sent as `X-CSRF-TOKEN` on every mutation. A `CSRF_FAILED` response refreshes the token and retries once. |
| Idempotency | Every `POST` carries an `Idempotency-Key`. Forms keep one key per submission, so a retry is not duplicated. |
| Concurrency | Product, customer, order and company edits send `If-Match: <rowVersion>`. A 409/412 shows a "changed elsewhere" message. |
| Errors | `ProblemDetails.errors[]` map to field-level messages (`lines.0.quantity` / `lines[0].quantity`). Modals stay open on failure. |
| Caching | All API calls use `cache: 'no-store'` (the backend also sends `Cache-Control: no-store`). Stock values are always fresh and never computed in the browser. |
| Lists | `page`, `pageSize` (10 by default), `search`, `period=day|week|month|custom` + `date`/`from`/`to`, plus module filters. |
| PDFs | Receipts and report PDFs are fetched with credentials and shown from a `blob:` URL (Preview / Download / Print). |

## Modules (sidebar)

Dashboard (8 indicators + low-stock alert) · Inventory/Products (create, edit with reason, deactivate, price history,
opening-stock correction, movement summary) · Stock In · Stock Out (Customer Order Delivery, Sample/Gift, Warehouse
Transfer) · Orders (partial deliveries, edit remaining only, edit history, receipt on completion) · Customers ·
Returns (against order / direct, Good/Damaged) · Stock Adjustments (Increase/Decrease, before/after) · Damaged Stock
(Mark as Good / Remove) · Reports (10 reports, PDF / Print / PNG) · Global Search · Audit Logs (edit/delete with
correction trail) · Backups (manual backup, download, typed RESTORE confirmation) · Settings (company, logo, theme,
logout).

After a transaction is saved, the app shows its number (SIN / SOUT / RET / ADJ) with **Preview PDF**, **Download PDF**
or **Skip**. Corrections create a new version with the same number; the old version is shown as *Superseded*.

## Layout

```
src/app/login/            login page (public)
src/app/(app)/            authenticated pages (AppShell guard + sidebar/header)
src/components/ui/        Button, Field, Modal, Display (tables, badges, pagination), Toast
src/components/           EntityCombobox, LinesEditor, PeriodFilter, Receipt, DeliveryForm, OrderForm, …
src/lib/                  api client, types (backend DTOs), hooks, formatting (Africa/Nairobi), auth
```
