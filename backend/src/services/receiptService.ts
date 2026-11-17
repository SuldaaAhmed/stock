import { db } from '../db/database';
import { v4 as uuidv4 } from 'uuid';
import PDFDocument from 'pdfkit';
import { allocateDocumentNumber } from './sequenceService';
import { getUtcTimestamp } from '../utils/date';

export interface CreateReceiptParams {
  sourceType: 'StockIn' | 'StockOut' | 'Return' | 'Adjustment' | 'DamagedAction' | 'Order';
  sourceEntityId: string;
  sourceVersion: number;
  customerName?: string;
  adminId: string;
  supersedesReceiptId?: string;
  receiptData: Record<string, any>;
}

export function createReceipt(params: CreateReceiptParams): { id: string; receiptNumber: string } {
  const company = db.prepare(`SELECT * FROM CompanySettings WHERE Singleton = 1`).get() as any;
  const receiptId = uuidv4();
  const receiptNumber = allocateDocumentNumber('Receipt');
  const now = getUtcTimestamp();

  if (params.supersedesReceiptId) {
    db.prepare(`
      UPDATE Receipts
      SET Status = 'Superseded'
      WHERE Id = ?
    `).run(params.supersedesReceiptId);
  }

  db.prepare(`
    INSERT INTO Receipts (
      Id, ReceiptNumber, SourceType, SourceEntityId, SourceVersion, Status,
      SupersedesReceiptId, IssuedAtUtc, CompanyNameSnapshot, CompanyPhoneSnapshot,
      CompanyEmailSnapshot, CompanyAddressSnapshot, CompanyLogoAssetId,
      CustomerNameSnapshot, ReceiptDataSnapshot, CreatedByAdminId
    ) VALUES (?, ?, ?, ?, ?, 'Active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    receiptId,
    receiptNumber,
    params.sourceType,
    params.sourceEntityId,
    params.sourceVersion,
    params.supersedesReceiptId || null,
    now,
    company?.CompanyName || 'Prime Stock Logistics Ltd',
    company?.Phone || null,
    company?.Email || null,
    company?.Address || null,
    company?.LogoAssetId || null,
    params.customerName || null,
    JSON.stringify(params.receiptData),
    params.adminId
  );

  return { id: receiptId, receiptNumber };
}

export function getReceiptById(id: string) {
  const row = db.prepare(`SELECT * FROM Receipts WHERE Id = ?`).get(id) as any;
  if (!row) return null;
  return {
    ...row,
    ReceiptData: JSON.parse(row.ReceiptDataSnapshot),
  };
}

export function generateReceiptPdf(receipt: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const buffers: Buffer[] = [];

      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        resolve(Buffer.concat(buffers));
      });

      // Header
      doc.fontSize(20).font('Helvetica-Bold').text(receipt.CompanyNameSnapshot || 'Company Name', { align: 'left' });
      doc.fontSize(10).font('Helvetica').fillColor('#555555');
      if (receipt.CompanyAddressSnapshot) doc.text(receipt.CompanyAddressSnapshot);
      if (receipt.CompanyPhoneSnapshot) doc.text(`Phone: ${receipt.CompanyPhoneSnapshot}`);
      if (receipt.CompanyEmailSnapshot) doc.text(`Email: ${receipt.CompanyEmailSnapshot}`);
      doc.moveDown();

      // Divider
      doc.strokeColor('#cccccc').lineWidth(1).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown();

      // Receipt Title & Meta
      doc.fillColor('#111827').fontSize(16).font('Helvetica-Bold').text(`RECEIPT: ${receipt.ReceiptNumber}`, { align: 'left' });
      doc.fontSize(10).font('Helvetica').fillColor('#4b5563');
      doc.text(`Document Type: ${receipt.SourceType}`);
      doc.text(`Issued Date: ${receipt.IssuedAtUtc ? new Date(receipt.IssuedAtUtc).toLocaleString('en-GB', { timeZone: 'Africa/Nairobi' }) : ''}`);
      if (receipt.CustomerNameSnapshot) {
        doc.text(`Customer: ${receipt.CustomerNameSnapshot}`);
      }
      if (receipt.Status === 'Superseded') {
        doc.fillColor('#dc2626').font('Helvetica-Bold').text('STATUS: SUPERSEDED');
      }
      doc.moveDown();

      // Details Table
      const data = receipt.ReceiptData || {};
      if (data.sourceNumber) {
        doc.fillColor('#111827').font('Helvetica-Bold').text(`Transaction Number: ${data.sourceNumber}`);
      }
      if (data.transactionDate) {
        doc.font('Helvetica').text(`Business Date: ${data.transactionDate}`);
      }
      if (data.reason) {
        doc.font('Helvetica').text(`Reason: ${data.reason}`);
      }
      if (data.recipientFullName) {
        doc.font('Helvetica').text(`Recipient: ${data.recipientFullName}`);
      }
      if (data.destinationWarehouseName) {
        doc.font('Helvetica').text(`Destination Warehouse: ${data.destinationWarehouseName}`);
      }
      if (data.sourceWarehouseName) {
        doc.font('Helvetica').text(`Source Warehouse: ${data.sourceWarehouseName}`);
      }
      doc.moveDown();

      // Items Table
      if (Array.isArray(data.items) && data.items.length > 0) {
        doc.fillColor('#111827').font('Helvetica-Bold').fontSize(11).text('Items:', { underline: true });
        doc.moveDown(0.5);

        // Table Header
        let y = doc.y;
        doc.rect(50, y, 495, 20).fill('#f3f4f6');
        doc.fillColor('#111827').fontSize(10).font('Helvetica-Bold');
        doc.text('#', 55, y + 5);
        doc.text('Product Name', 80, y + 5);
        doc.text('Quantity (BOX)', 430, y + 5, { align: 'right', width: 100 });
        y += 24;

        data.items.forEach((item: any, idx: number) => {
          doc.fillColor('#374151').font('Helvetica').fontSize(10);
          doc.text(String(idx + 1), 55, y);
          doc.text(item.productName || item.productNameSnapshot || 'Product', 80, y);
          doc.text(String(item.quantity || item.orderedQuantity || item.quantityDelivered) + ' BOX', 430, y, { align: 'right', width: 100 });
          y += 18;
        });
        doc.y = y + 10;
      }

      doc.moveDown(2);
      doc.strokeColor('#e5e7eb').lineWidth(1).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown();
      doc.fontSize(8).fillColor('#9ca3af').text('Official Electronic Stock Record • Verified by Stock Engine', { align: 'center' });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
