import { Router, Request, Response } from 'express';
import { getReceiptById, generateReceiptPdf } from '../services/receiptService';

export const receiptRouter = Router();

// GET /receipts/:id
receiptRouter.get('/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const receipt = getReceiptById(id);

  if (!receipt) {
    return res.status(404).json({
      type: 'NOT_FOUND',
      title: 'Receipt not found.',
      status: 404,
      requestId: req.headers['x-request-id'] || 'req-' + Date.now(),
    });
  }

  return res.json({
    data: receipt,
    requestId: req.headers['x-request-id'] || 'req-' + Date.now(),
  });
});

// GET /receipts/:id/pdf
receiptRouter.get('/:id/pdf', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { disposition = 'inline' } = req.query;

  const receipt = getReceiptById(id);
  if (!receipt) {
    return res.status(404).json({
      type: 'NOT_FOUND',
      title: 'Receipt not found.',
      status: 404,
      requestId: req.headers['x-request-id'] || 'req-' + Date.now(),
    });
  }

  try {
    const pdfBuffer = await generateReceiptPdf(receipt);
    const filename = `${receipt.ReceiptNumber}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      disposition === 'attachment' ? `attachment; filename="${filename}"` : `inline; filename="${filename}"`
    );
    res.setHeader('Content-Length', pdfBuffer.length);

    return res.send(pdfBuffer);
  } catch (err) {
    console.error('Error generating PDF:', err);
    return res.status(500).json({
      type: 'PDF_GENERATION_FAILED',
      title: 'Failed to generate PDF document.',
      status: 500,
      requestId: req.headers['x-request-id'] || 'req-' + Date.now(),
    });
  }
});
