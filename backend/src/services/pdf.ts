import PDFDocument from 'pdfkit';
import { formatNairobiDateTime } from '../utils/dates';
import type { ReceiptPayload } from './receipts';

/**
 * One consistent professional template for every receipt type and report:
 * company header (logo + details), title block, key/value fields, line table, totals, footer.
 */

export interface CompanyInfo {
  companyName: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
}

export interface Column {
  key: string;
  label: string;
  align?: 'left' | 'right';
  width?: number; // relative weight
  format?: 'money' | 'int';
}

const MARGIN = 40;
const ACCENT = '#1f3a5f';
const MUTED = '#666666';

function toBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

function header(doc: PDFKit.PDFDocument, company: CompanyInfo, logo: Buffer | null, title: string, rightLines: string[]) {
  const top = MARGIN;
  let textX = MARGIN;
  if (logo) {
    try {
      doc.image(logo, MARGIN, top, { fit: [70, 70] });
      textX = MARGIN + 82;
    } catch {
      /* unsupported image – ignore logo */
    }
  }
  doc.fillColor(ACCENT).font('Helvetica-Bold').fontSize(16).text(company.companyName || '', textX, top, { width: 260 });
  doc.fillColor(MUTED).font('Helvetica').fontSize(9);
  for (const line of [company.address, company.phone, company.email].filter(Boolean) as string[]) doc.text(line, textX, undefined, { width: 260 });

  const rx = doc.page.width - MARGIN - 220;
  doc.fillColor(ACCENT).font('Helvetica-Bold').fontSize(14).text(title, rx, top, { width: 220, align: 'right' });
  doc.fillColor('#000').font('Helvetica').fontSize(9);
  for (const l of rightLines) doc.text(l, rx, undefined, { width: 220, align: 'right' });

  const y = Math.max(doc.y, top + 78) + 8;
  doc.moveTo(MARGIN, y).lineTo(doc.page.width - MARGIN, y).lineWidth(1.5).strokeColor(ACCENT).stroke();
  doc.y = y + 12;
  doc.x = MARGIN;
}

function fieldsBlock(doc: PDFKit.PDFDocument, fields: { label: string; value: string }[]) {
  const colW = (doc.page.width - MARGIN * 2) / 2;
  let i = 0;
  let rowY = doc.y;
  for (const f of fields) {
    const x = MARGIN + (i % 2) * colW;
    if (i % 2 === 0 && i > 0) rowY = doc.y + 4;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text(f.label.toUpperCase(), x, rowY, { width: colW - 10 });
    doc.font('Helvetica').fontSize(10).fillColor('#000').text(f.value ?? '-', x, undefined, { width: colW - 10 });
    i++;
  }
  doc.x = MARGIN;
  doc.moveDown(1);
}

function table(doc: PDFKit.PDFDocument, columns: Column[], rows: Record<string, unknown>[], onNewPage?: () => void) {
  const totalW = doc.page.width - MARGIN * 2;
  const weights = columns.map((c) => c.width ?? (c.key === 'no' ? 0.4 : c.align === 'right' ? 1 : 2));
  const sum = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => (w / sum) * totalW);
  const drawHead = () => {
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(8.5);
    // Header grows to fit wrapped labels (e.g. "Selling Price (KES)") instead of clipping them.
    const hh = Math.max(18, ...columns.map((c, i) => doc.heightOfString(c.label, { width: widths[i] - 8 }) + 10));
    doc.rect(MARGIN, y, totalW, hh).fill(ACCENT);
    let x = MARGIN;
    doc.fillColor('#fff');
    columns.forEach((c, i) => {
      doc.text(c.label, x + 4, y + 5, { width: widths[i] - 8, align: c.align ?? 'left' });
      x += widths[i];
    });
    doc.y = y + hh + 2;
  };
  drawHead();
  doc.font('Helvetica').fontSize(8.5).fillColor('#000');
  rows.forEach((r, idx) => {
    const cells = columns.map((c) => formatCell(r[c.key], c));
    const h = Math.max(...cells.map((t, i) => doc.heightOfString(t, { width: widths[i] - 8 }))) + 6;
    if (doc.y + h > doc.page.height - MARGIN - 30) {
      doc.addPage();
      onNewPage?.();
      drawHead();
      doc.font('Helvetica').fontSize(8.5).fillColor('#000');
    }
    const y = doc.y;
    if (idx % 2 === 1) doc.rect(MARGIN, y, totalW, h).fill('#f2f5f9');
    doc.fillColor('#000');
    let x = MARGIN;
    cells.forEach((t, i) => {
      doc.text(t, x + 4, y + 3, { width: widths[i] - 8, align: columns[i].align ?? 'left' });
      x += widths[i];
    });
    doc.y = y + h;
  });
  if (!rows.length) doc.font('Helvetica-Oblique').fillColor(MUTED).text('No records.', MARGIN + 4, doc.y + 4);
  doc.x = MARGIN;
  doc.moveDown(0.8);
}

const moneyFmt = new Intl.NumberFormat('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const intFmt = new Intl.NumberFormat('en-KE', { maximumFractionDigits: 0 });

function formatCell(v: unknown, c: Column): string {
  if (v === null || v === undefined || v === '') return '';
  if (c.format === 'money') return Number.isFinite(Number(v)) ? moneyFmt.format(Number(v)) : String(v);
  if (c.format === 'int') return Number.isFinite(Number(v)) ? intFmt.format(Number(v)) : String(v);
  return String(v);
}

function totalsBlock(doc: PDFKit.PDFDocument, totals: { label: string; value: string }[]) {
  const w = 240;
  const x = doc.page.width - MARGIN - w;
  for (const t of totals) {
    const y = doc.y;
    doc.font('Helvetica').fontSize(10).fillColor(MUTED).text(t.label, x, y, { width: 120 });
    doc.font('Helvetica-Bold').fillColor('#000').text(t.value, x + 120, y, { width: 120, align: 'right' });
    doc.y = y + 15;
  }
  doc.x = MARGIN;
}

function footer(doc: PDFKit.PDFDocument, text: string) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const y = doc.page.height - MARGIN + 5;
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED);
    doc.text(text, MARGIN, y, { width: 400, lineBreak: false });
    doc.text(`Page ${i - range.start + 1} of ${range.count}`, doc.page.width - MARGIN - 100, y, { width: 100, align: 'right', lineBreak: false });
  }
}

export async function renderReceiptPdf(r: {
  receiptNumber: string;
  status: string;
  createdAt: Date | string;
  company: CompanyInfo;
  logo: Buffer | null;
  payload: ReceiptPayload;
}): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true, info: { Title: `${r.payload.title} ${r.receiptNumber}` } });
  header(doc, r.company, r.logo, r.payload.title, [
    `Receipt No: ${r.receiptNumber}`,
    `Date: ${r.payload.businessDate}`,
    `Issued: ${formatNairobiDateTime(r.createdAt)}`,
  ]);
  if (r.status === 'Superseded') {
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#b00020').text('SUPERSEDED – replaced by a corrected version', { align: 'center' });
    doc.moveDown(0.6);
  }
  fieldsBlock(doc, r.payload.fields);
  table(doc, r.payload.columns, r.payload.lines);
  totalsBlock(doc, r.payload.totals);
  if (r.payload.notes) {
    doc.moveDown(0.8).font('Helvetica-Oblique').fontSize(9).fillColor(MUTED).text(r.payload.notes, MARGIN);
  }
  doc.moveDown(3);
  const y = doc.y;
  if (y < doc.page.height - MARGIN - 60) {
    doc.moveTo(MARGIN, y).lineTo(MARGIN + 180, y).strokeColor('#999').lineWidth(0.7).stroke();
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text('Authorised by (Admin)', MARGIN, y + 4);
  }
  footer(doc, `${r.company.companyName} · ${r.receiptNumber} · Quantities in BOX · Generated by the Stock Management System`);
  return toBuffer(doc);
}

export async function renderReportPdf(r: {
  title: string;
  company: CompanyInfo;
  logo: Buffer | null;
  filterLines: string[];
  summary: { label: string; value: string }[];
  columns: Column[];
  rows: Record<string, unknown>[];
  extraSection?: { title: string; columns: Column[]; rows: Record<string, unknown>[] };
}): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: MARGIN, bufferPages: true, info: { Title: r.title } });
  header(doc, r.company, r.logo, r.title, [`Generated: ${formatNairobiDateTime(new Date())}`, ...r.filterLines]);
  fieldsBlock(doc, r.summary);
  if (r.extraSection) {
    doc.font('Helvetica-Bold').fontSize(11).fillColor(ACCENT).text(r.extraSection.title, MARGIN);
    doc.moveDown(0.3);
    table(doc, r.extraSection.columns, r.extraSection.rows);
    doc.font('Helvetica-Bold').fontSize(11).fillColor(ACCENT).text('Records', MARGIN);
    doc.moveDown(0.3);
  }
  table(doc, r.columns, r.rows);
  footer(doc, `${r.company.companyName} · ${r.title} · Quantities in BOX`);
  return toBuffer(doc);
}
