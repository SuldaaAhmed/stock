import type { Db } from '../db/pool';
import type { Actor } from '../http/context';
import { notFound } from '../http/errors';
import { nextNumber } from './numbering';

export type ReceiptType = 'StockIn' | 'SampleGift' | 'WarehouseTransfer' | 'Return' | 'Adjustment' | 'DamagedStockAction' | 'CustomerOrder';

/** Uniform, render-ready snapshot used by the single PDF template. */
export interface ReceiptPayload {
  title: string;
  sourceNumber: string;
  secondaryNumber?: string | null;
  version: number;
  businessDate: string;
  fields: { label: string; value: string }[];
  columns: { key: string; label: string; align?: 'left' | 'right' }[];
  lines: Record<string, string | number | null>[];
  totals: { label: string; value: string }[];
  notes?: string | null;
}

export async function companySnapshot(db: Db) {
  const r = await db.query('SELECT company_name, phone, email, address, logo_file_id FROM company_settings WHERE id = 1');
  const c = r.rows[0] ?? { company_name: 'My Company' };
  return {
    snapshot: { companyName: c.company_name, phone: c.phone ?? null, email: c.email ?? null, address: c.address ?? null },
    logoFileId: (c.logo_file_id as string | null) ?? null,
  };
}

/** Creates the immutable receipt record (REC- number + company snapshot) inside the posting transaction. */
export async function createReceipt(
  tx: Db,
  actor: Actor,
  args: {
    receiptType: ReceiptType;
    sourceType: string;
    sourceId: string;
    sourceNumber: string;
    sourceVersion: number;
    businessDate: string;
    payload: ReceiptPayload;
    /** Pre-allocated REC- number (used when the number must appear on the source itself). */
    receiptNumber?: string;
  },
): Promise<{ id: string; receiptNumber: string }> {
  const number = args.receiptNumber ?? (await nextNumber(tx, 'REC'));
  const company = await companySnapshot(tx);
  const r = await tx.query(
    `INSERT INTO receipts(receipt_number, receipt_type, source_type, source_id, source_number, source_version,
                          company_snapshot, logo_file_id, payload, business_date, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [
      number,
      args.receiptType,
      args.sourceType,
      args.sourceId,
      args.sourceNumber,
      args.sourceVersion,
      JSON.stringify(company.snapshot),
      company.logoFileId,
      JSON.stringify(args.payload),
      args.businessDate,
      actor.adminId,
    ],
  );
  return { id: r.rows[0].id, receiptNumber: number };
}

export async function supersedeReceipt(tx: Db, oldReceiptId: string | null, newReceiptId: string) {
  if (!oldReceiptId) return;
  await tx.query(`UPDATE receipts SET status='Superseded', superseded_by_id=$2 WHERE id=$1`, [oldReceiptId, newReceiptId]);
}

export function mapReceipt(r: any) {
  return {
    id: r.id,
    receiptNumber: r.receipt_number,
    receiptType: r.receipt_type,
    sourceType: r.source_type,
    sourceId: r.source_id,
    sourceNumber: r.source_number,
    sourceVersion: r.source_version,
    status: r.status,
    supersededById: r.superseded_by_id,
    businessDate: r.business_date,
    company: r.company_snapshot,
    hasLogo: !!r.logo_file_id,
    content: r.payload,
    createdAt: r.created_at,
    pdfUrl: `/api/v1/receipts/${r.id}/pdf`,
  };
}

export async function getReceipt(db: Db, id: string) {
  const r = await db.query('SELECT * FROM receipts WHERE id = $1', [id]);
  if (!r.rowCount) throw notFound('Receipt');
  return r.rows[0];
}

export const fmtQty = (n: number) => `${n.toLocaleString('en-KE')} BOX`;
