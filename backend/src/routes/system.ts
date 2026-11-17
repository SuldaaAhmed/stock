import multer from 'multer';
import { z } from 'zod';
import { config } from '../config';
import { one, pool } from '../db/pool';
import { actorFrom } from '../http/context';
import { AppError, badRequest, notFound } from '../http/errors';
import { CSRF_HEADER, issueCsrfToken } from '../http/middleware/csrf';
import { loginRetryAfter, recordLoginFailure, recordLoginSuccess } from '../http/middleware/loginThrottle';
import { route } from '../http/router';
import { listQuery, zBoolParam, zEmailOpt, zOptText, zReason, zText } from '../http/validation';
import { audit } from '../services/audit';
import * as auditLogs from '../services/auditLogs';
import * as backups from '../services/backups/backupService';
import { etag, parseIfMatch } from '../services/common';
import { dashboardSummary } from '../services/dashboard';
import { loadStoredFile, sniffImage, storeLogo } from '../services/files';
import { DUMMY_HASH, verifyPassword } from '../services/passwordHasher';
import { renderReceiptPdf, renderReportPdf } from '../services/pdf';
import { getReceipt, mapReceipt } from '../services/receipts';
import { REPORT_TYPES, runReport } from '../services/reports';
import { globalSearch, SEARCH_TYPES } from '../services/search';
import { createSession, revokeSession, SESSION_COOKIE, sessionCookieOptions } from '../services/sessions';
import * as settings from '../services/settings';

// ------------------------------------------------------------------ Auth
route({
  method: 'get', path: '/auth/csrf', tag: 'Auth', auth: false, summary: 'Issue the anti-forgery token (send it as X-CSRF-TOKEN on POST/PUT/PATCH/DELETE)',
  handler: async ({ req, res }) => ({ data: { token: issueCsrfToken(req, res), headerName: CSRF_HEADER } }),
});

route({
  method: 'post', path: '/auth/login', tag: 'Auth', auth: false, successStatus: 200, summary: 'Admin login (username + password)',
  description: 'Sets an HttpOnly session cookie. Repeated failures from the same IP/username are throttled with a progressive delay (429 + Retry-After); there is no permanent lockout.',
  body: z.object({ username: z.string().trim().min(1, 'Username is required.').max(100), password: z.string().min(1, 'Password is required.').max(200) }),
  handler: async ({ req, res, body }) => {
    const wait = loginRetryAfter(req.ip, body.username);
    if (wait > 0) {
      throw new AppError(429, 'TOO_MANY_ATTEMPTS', `Too many failed login attempts. Try again in ${wait} seconds.`, undefined, { 'Retry-After': String(wait) });
    }
    const admin = await one(pool, 'SELECT * FROM admins WHERE normalized_username = $1', [body.username.toUpperCase()]);
    const ok = verifyPassword(admin?.password_hash ?? DUMMY_HASH, body.password) && !!admin;
    if (!ok) {
      recordLoginFailure(req.ip, body.username);
      await audit(pool, { adminId: null, username: 'anonymous', requestId: req.requestId, ip: req.ip }, {
        action: 'Auth.LoginFailed',
        entityType: 'Admin',
        description: `Failed login attempt for username "${body.username.slice(0, 100)}"`,
      });
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid username or password.');
    }
    recordLoginSuccess(req.ip, body.username);
    const s = await createSession(pool, admin.id, admin.security_stamp, req.ip, req.header('user-agent'));
    res.cookie(SESSION_COOKIE, s.token, sessionCookieOptions());
    await audit(pool, { adminId: admin.id, username: admin.username, requestId: req.requestId, ip: req.ip }, { action: 'Auth.Login', entityType: 'Admin', entityId: admin.id });
    const prefs = await settings.getPreferences(pool, admin.id);
    return { data: { admin: { id: admin.id, username: admin.username }, theme: prefs.theme, expiresAt: s.expiresAt, absoluteExpiresAt: s.absoluteExpiresAt } };
  },
});

route({
  method: 'post', path: '/auth/logout', tag: 'Auth', successStatus: 204, summary: 'Logout (revokes the session)',
  handler: async ({ req, res }) => {
    await revokeSession(pool, req.admin!.sessionId);
    await audit(pool, actorFrom(req), { action: 'Auth.Logout', entityType: 'Admin', entityId: req.admin!.id });
    res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions(), maxAge: undefined });
    return undefined;
  },
});

route({
  method: 'get', path: '/auth/me', tag: 'Auth', summary: 'Current authenticated session',
  handler: async ({ req }) => {
    const s = await one(pool, 'SELECT expires_at, absolute_expires_at FROM admin_sessions WHERE id = $1', [req.admin!.sessionId]);
    const prefs = await settings.getPreferences(pool, req.admin!.id);
    return { data: { admin: { id: req.admin!.id, username: req.admin!.username }, theme: prefs.theme, expiresAt: s?.expires_at, absoluteExpiresAt: s?.absolute_expires_at } };
  },
});

// ------------------------------------------------------------------ Dashboard / search
route({
  method: 'get', path: '/dashboard/summary', tag: 'Dashboard', summary: 'Dashboard cards and recent activity',
  handler: async () => ({ data: await dashboardSummary(pool) }),
});

route({
  method: 'get', path: '/search', tag: 'Search', summary: 'Global search (products, customers, all document numbers)',
  description: `search=keyword, type=${SEARCH_TYPES.join('|')}, period/date/from/to. Results carry resourceType, id, display, date and detailPath.`,
  query: listQuery(),
  handler: async ({ query }) => {
    if (!query.search && !query.type && !query.period && !query.from && !query.to) {
      throw badRequest('Provide a search keyword or at least one filter.', [{ field: 'search', message: 'Search keyword is required when no filters are given.' }]);
    }
    const r = await globalSearch(pool, query);
    return { data: r.items, meta: r.meta };
  },
});

// ------------------------------------------------------------------ Receipts
route({
  method: 'get', path: '/receipts/:id', tag: 'Receipts', summary: 'Receipt record (immutable snapshot)',
  handler: async ({ params }) => ({ data: mapReceipt(await getReceipt(pool, params.id)) }),
});

route({
  method: 'get', path: '/receipts/:id/pdf', tag: 'Receipts', produces: 'pdf', summary: 'Render receipt PDF (disposition=inline for preview, attachment for download)',
  query: z.object({ disposition: z.enum(['inline', 'attachment']).default('inline') }),
  handler: async ({ params, query, res }) => {
    const r = await getReceipt(pool, params.id);
    const logo = await loadStoredFile(pool, r.logo_file_id);
    const pdf = await renderReceiptPdf({ receiptNumber: r.receipt_number, status: r.status, createdAt: r.created_at, company: r.company_snapshot, logo: logo?.data ?? null, payload: r.payload });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${query.disposition}; filename="${r.receipt_number}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(pdf);
  },
});

// ------------------------------------------------------------------ Reports
const reportQuery = listQuery({ condition: z.enum(['Good', 'Damaged']).optional() });
const reportDesc = `reportType: ${REPORT_TYPES.join(', ')}. Filters: period (day|week|month|custom, Monday week start, Nairobi calendar) + date/from/to, productId, customerId, type, status, search. Snapshot reports (current-stock, low-stock) ignore date filters.`;

route({
  method: 'get', path: '/reports/:reportType', tag: 'Reports', summary: 'Filtered report data (paginated) with summary totals', description: reportDesc,
  query: reportQuery,
  handler: async ({ params, query }) => {
    const r = await runReport(pool, params.reportType, query);
    return { data: r.rows, meta: r.meta };
  },
});

route({
  method: 'get', path: '/reports/:reportType/export/pdf', tag: 'Reports', produces: 'pdf', summary: 'Export the whole filtered report as PDF', description: reportDesc,
  query: reportQuery,
  handler: async ({ params, query, res, req }) => {
    const r = await runReport(pool, params.reportType, query, false);
    const company = await settings.getCompany(pool);
    const logo = await loadStoredFile(pool, company.logoFileId);
    const filterLines: string[] = [];
    if (r.meta.period) filterLines.push(`Period: ${r.meta.period.from} to ${r.meta.period.to}`);
    if (query.productId) filterLines.push(`Product: ${(await one(pool, 'SELECT name FROM products WHERE id=$1', [query.productId]))?.name ?? query.productId}`);
    if (query.customerId) filterLines.push(`Customer: ${(await one(pool, 'SELECT full_name FROM customers WHERE id=$1', [query.customerId]))?.full_name ?? query.customerId}`);
    if (query.type) filterLines.push(`Type: ${query.type}`);
    if (query.status) filterLines.push(`Status: ${query.status}`);
    if (query.search) filterLines.push(`Search: ${query.search}`);
    const summary = Object.entries(r.meta.summary as Record<string, number>).map(([k, v]) => ({
      label: k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()),
      value: String(v),
    }));
    const balances = (r.meta as any).balances as any[] | undefined;
    const pdf = await renderReportPdf({
      title: r.meta.title,
      company: { companyName: company.companyName, phone: company.phone, email: company.email, address: company.address },
      logo: logo?.data ?? null,
      filterLines,
      summary,
      columns: r.def.columns,
      rows: r.rows,
      extraSection: balances
        ? {
            title: 'Current Damaged Balances',
            columns: [
              { key: 'productName', label: 'Product', width: 3 },
              { key: 'damagedStock', label: 'Damaged (BOX)', align: 'right' },
              { key: 'availableStock', label: 'Available (BOX)', align: 'right' },
            ],
            rows: balances,
          }
        : undefined,
    });
    await audit(pool, actorFrom(req), { action: 'Report.ExportPdf', entityType: 'Report', entityId: params.reportType, newData: { filters: query } });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${params.reportType}-report.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(pdf);
  },
});

// ------------------------------------------------------------------ Settings
route({
  method: 'get', path: '/settings/company', tag: 'Settings', summary: 'Company information',
  handler: async () => { const c = await settings.getCompany(pool); return { data: c, headers: { ETag: etag(c.rowVersion) } }; },
});
route({
  method: 'patch', path: '/settings/company', tag: 'Settings', summary: 'Edit company information (If-Match required)', ifMatch: true,
  body: z.object({ companyName: zText(150).optional(), phone: zOptText(40), email: zEmailOpt, address: zOptText(500), rowVersion: z.number().int().optional() }).strict(),
  handler: ({ body, actor, req, mutate }) => mutate(async (tx) => {
    const c = await settings.updateCompany(tx, actor, parseIfMatch(req.header('If-Match'), body.rowVersion), body);
    return { data: c, headers: { ETag: etag(c.rowVersion) } };
  }),
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.logoMaxBytes, files: 1 } });
route({
  method: 'get', path: '/settings/company/logo', tag: 'Settings', produces: 'image', summary: 'Current company logo image',
  handler: async ({ res }) => {
    const c = await settings.getCompany(pool);
    const f = await loadStoredFile(pool, c.logoFileId);
    if (!f) throw notFound('Logo');
    res.setHeader('Content-Type', f.contentType);
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(f.data);
  },
});
route({
  method: 'put', path: '/settings/company/logo', tag: 'Settings', multipart: true, summary: `Upload or replace the logo (multipart field "file"; PNG or JPEG, max ${Math.round(config.logoMaxBytes / 1024)} KB)`,
  handler: async ({ req, res, actor }) => {
    await new Promise<void>((resolve, reject) => upload.single('file')(req, res, (err: unknown) => (err ? reject(err) : resolve())));
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) throw badRequest('One or more validation errors occurred.', [{ field: 'file', message: 'A logo file is required (multipart field "file").' }]);
    const type = sniffImage(file.buffer);
    if (!type) throw badRequest('One or more validation errors occurred.', [{ field: 'file', message: 'Only PNG or JPEG images are accepted.' }]);
    const { withTransaction } = await import('../db/pool');
    const result = await withTransaction(async (tx) => {
      const stored = await storeLogo(tx, actor.adminId, file.buffer, file.originalname, type);
      return settings.setLogo(tx, actor, stored.id);
    });
    await settings.deleteDetachedFile(result.deleteKey);
    return { data: result.company, status: 200, headers: { ETag: etag(result.company.rowVersion) } };
  },
});
route({
  method: 'delete', path: '/settings/company/logo', tag: 'Settings', successStatus: 200, summary: 'Remove the logo (files referenced by receipts are kept)',
  handler: async ({ actor, mutate }) => {
    let key: string | null = null;
    const r = await mutate(async (tx) => {
      const out = await settings.setLogo(tx, actor, null);
      key = out.deleteKey;
      return { data: out.company, status: 200 };
    });
    await settings.deleteDetachedFile(key);
    return r;
  },
});
route({
  method: 'get', path: '/settings/preferences', tag: 'Settings', summary: 'Admin preferences (theme)',
  handler: async ({ actor }) => ({ data: await settings.getPreferences(pool, actor.adminId) }),
});
route({
  method: 'patch', path: '/settings/preferences', tag: 'Settings', summary: 'Update theme preference (Light, Dark, System)',
  body: z.object({ theme: z.enum(['Light', 'Dark', 'System']) }).strict(),
  handler: ({ body, actor, mutate }) => mutate(async (tx) => ({ data: await settings.updatePreferences(tx, actor, body) })),
});

// ------------------------------------------------------------------ Audit
route({
  method: 'get', path: '/audit-logs', tag: 'Audit', summary: 'List audit logs',
  description: 'Filters: action (prefix, or type), entityType, period, search, includeDeleted=true.',
  query: listQuery({ includeDeleted: zBoolParam, entityType: z.string().max(60).optional(), action: z.string().max(80).optional() }),
  handler: async ({ query }) => { const r = await auditLogs.listAuditLogs(pool, query); return { data: r.items, meta: r.meta }; },
});
route({
  method: 'get', path: '/audit-logs/:id', tag: 'Audit', summary: 'Audit log entry with its correction trail',
  handler: async ({ params }) => ({ data: await auditLogs.getAuditLog(pool, params.id) }),
});
route({
  method: 'patch', path: '/audit-logs/:id', tag: 'Audit', summary: 'Edit an audit entry (editable: description, note; reason required)',
  description: 'Creates an immutable correction-trail record. The trail itself cannot be edited or deleted.',
  body: z.object({ description: zOptText(2000), note: zOptText(2000), reason: zReason }).strict(),
  handler: ({ body, actor, params, mutate }) => mutate(async (tx) => {
    const r = await auditLogs.editAuditLog(tx, actor, params.id, body);
    await audit(tx, actor, { action: 'AuditLog.Edit', entityType: 'AuditLog', entityId: params.id, description: body.reason });
    return { data: r };
  }),
});
route({
  method: 'delete', path: '/audit-logs/:id', tag: 'Audit', summary: 'Soft-delete an audit entry (reason required in body or ?reason=)',
  description: 'Hidden from default views; kept in the immutable correction trail.',
  handler: ({ actor, params, req, mutate }) => {
    const reason = String(req.body?.reason ?? req.query.reason ?? '').trim();
    if (!reason) throw badRequest('One or more validation errors occurred.', [{ field: 'reason', message: 'A reason is required.' }]);
    return mutate(async (tx) => {
      await auditLogs.deleteAuditLog(tx, actor, params.id, reason.slice(0, 1000));
      await audit(tx, actor, { action: 'AuditLog.Delete', entityType: 'AuditLog', entityId: params.id, description: reason.slice(0, 1000) });
      return { status: 204 };
    });
  },
});
route({
  method: 'get', path: '/audit-log-corrections', tag: 'Audit', summary: 'Read-only correction trail of audit-log edits/deletions',
  query: listQuery({ auditLogId: z.coerce.number().int().positive().optional() }),
  handler: async ({ query }) => { const r = await auditLogs.listAuditCorrections(pool, query); return { data: r.items, meta: r.meta }; },
});

// ------------------------------------------------------------------ Backups
route({
  method: 'get', path: '/backups', tag: 'Backups', summary: 'Backup and restore logs',
  description: 'type=Backup|Restore|Manual|Automatic|PreRestore, status=Running|Succeeded|Failed.',
  query: listQuery(),
  handler: async ({ query }) => { const r = await backups.listBackupLogs(query); return { data: r.items, meta: r.meta }; },
});
route({
  method: 'post', path: '/backups', tag: 'Backups', summary: 'Run a manual backup (full database + logo files, encrypted at rest)', idempotent: true,
  handler: async ({ actor }) => {
    const b = await backups.runBackup('Manual', actor);
    return { data: b, status: 201, location: `/api/v1/backups/${b.id}` };
  },
});
route({
  method: 'get', path: '/backups/:id', tag: 'Backups', summary: 'Backup log detail',
  handler: async ({ params }) => ({ data: await backups.getBackupLog(params.id) }),
});
route({
  method: 'get', path: '/backups/:id/download', tag: 'Backups', produces: 'binary', summary: 'Download the (encrypted) backup file',
  handler: async ({ params, res, actor }) => {
    const f = await backups.downloadBackup(params.id);
    await audit(pool, actor, { action: 'Backup.Download', entityType: 'Backup', entityId: params.id });
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${f.fileName}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.end(f.data);
  },
});
route({
  method: 'post', path: '/backups/:id/restore', tag: 'Backups', successStatus: 200, summary: 'Restore a backup (explicit confirmation required)',
  description:
    'Body must contain {"confirm": true, "confirmationText": "RESTORE"}. Creates a pre-restore backup, enters maintenance mode, restores atomically, invalidates ALL sessions (log in again) and reconciles balances against the ledger.',
  body: z.object({ confirm: z.literal(true, { error: 'Explicit confirmation is required.' }), confirmationText: z.literal('RESTORE', { error: 'Type RESTORE to confirm.' }) }),
  handler: async ({ params, actor, res }) => {
    const r = await backups.restoreBackup(params.id, actor);
    res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions(), maxAge: undefined });
    return { data: r };
  },
});

