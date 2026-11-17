'use client';

import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { X, FileText, Download, ExternalLink, Printer } from 'lucide-react';

interface ReceiptModalProps {
  receiptId: string | null;
  onClose: () => void;
}

export function ReceiptModal({ receiptId, onClose }: ReceiptModalProps) {
  const [receipt, setReceipt] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!receiptId) return;
    setLoading(true);
    api.receipts
      .get(receiptId)
      .then((res) => setReceipt(res.data))
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
  }, [receiptId]);

  if (!receiptId) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-800 w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-emerald-600" />
            <h3 className="font-bold text-gray-900 dark:text-white text-base">
              Receipt Document: {receipt?.ReceiptNumber || '...'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-sm">
          {loading ? (
            <div className="py-12 text-center text-gray-500">Loading receipt details...</div>
          ) : receipt ? (
            <>
              {/* Company Header */}
              <div className="bg-gray-50 dark:bg-gray-800/60 p-4 rounded-lg border border-gray-100 dark:border-gray-800">
                <h4 className="font-bold text-base text-gray-900 dark:text-white">
                  {receipt.CompanyNameSnapshot}
                </h4>
                {receipt.CompanyAddressSnapshot && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">{receipt.CompanyAddressSnapshot}</p>
                )}
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 flex gap-4">
                  {receipt.CompanyPhoneSnapshot && <span>Phone: {receipt.CompanyPhoneSnapshot}</span>}
                  {receipt.CompanyEmailSnapshot && <span>Email: {receipt.CompanyEmailSnapshot}</span>}
                </div>
              </div>

              {/* Document Meta */}
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <span className="text-gray-500">Receipt Number:</span>
                  <p className="font-semibold text-gray-900 dark:text-white font-mono text-sm">{receipt.ReceiptNumber}</p>
                </div>
                <div>
                  <span className="text-gray-500">Document Type:</span>
                  <p className="font-semibold text-gray-900 dark:text-white">{receipt.SourceType}</p>
                </div>
                <div>
                  <span className="text-gray-500">Issued Date (Nairobi):</span>
                  <p className="font-semibold text-gray-900 dark:text-white">
                    {new Date(receipt.IssuedAtUtc).toLocaleString('en-GB', { timeZone: 'Africa/Nairobi' })}
                  </p>
                </div>
                <div>
                  <span className="text-gray-500">Transaction Status:</span>
                  <p
                    className={`font-semibold ${
                      receipt.Status === 'Superseded' ? 'text-rose-600' : 'text-emerald-600'
                    }`}
                  >
                    {receipt.Status}
                  </p>
                </div>
                {receipt.ReceiptData?.sourceNumber && (
                  <div>
                    <span className="text-gray-500">Reference Number:</span>
                    <p className="font-semibold text-gray-900 dark:text-white font-mono">
                      {receipt.ReceiptData.sourceNumber}
                    </p>
                  </div>
                )}
                {receipt.ReceiptData?.recipientFullName && (
                  <div>
                    <span className="text-gray-500">Recipient:</span>
                    <p className="font-semibold text-gray-900 dark:text-white">
                      {receipt.ReceiptData.recipientFullName}
                    </p>
                  </div>
                )}
                {receipt.ReceiptData?.destinationWarehouseName && (
                  <div>
                    <span className="text-gray-500">Destination Warehouse:</span>
                    <p className="font-semibold text-gray-900 dark:text-white">
                      {receipt.ReceiptData.destinationWarehouseName}
                    </p>
                  </div>
                )}
                {receipt.ReceiptData?.sourceWarehouseName && (
                  <div>
                    <span className="text-gray-500">Source Warehouse:</span>
                    <p className="font-semibold text-gray-900 dark:text-white">
                      {receipt.ReceiptData.sourceWarehouseName}
                    </p>
                  </div>
                )}
              </div>

              {/* Items Table */}
              <div>
                <h5 className="font-semibold text-xs text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-2">
                  Items Verified
                </h5>
                <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 font-semibold border-b border-gray-200 dark:border-gray-800">
                      <tr>
                        <th className="py-2 px-3">#</th>
                        <th className="py-2 px-3">Product Name</th>
                        <th className="py-2 px-3 text-right">Quantity (BOX)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {receipt.ReceiptData?.items?.map((item: any, idx: number) => (
                        <tr key={idx} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30">
                          <td className="py-2 px-3 text-gray-400">{idx + 1}</td>
                          <td className="py-2 px-3 font-medium text-gray-900 dark:text-white">
                            {item.productName || item.productNameSnapshot}
                          </td>
                          <td className="py-2 px-3 text-right font-bold text-gray-900 dark:text-white">
                            {item.quantity || item.quantityDelivered || item.orderedQuantity} BOX
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <div className="py-12 text-center text-gray-500">No receipt data found.</div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 bg-gray-50 dark:bg-gray-800/40 border-t border-gray-200 dark:border-gray-800 flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            Close / Skip
          </button>
          <div className="flex items-center gap-2">
            <a
              href={api.receipts.getPdfUrl(receiptId, 'inline')}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-white rounded-lg transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Preview PDF
            </a>
            <a
              href={api.receipts.getPdfUrl(receiptId, 'attachment')}
              download
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg shadow-sm transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Download PDF
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
