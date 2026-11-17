'use client';

import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { ReceiptModal } from '../../components/ReceiptModal';
import {
  ArrowDownToLine,
  Plus,
  Search,
  Filter,
  FileText,
  Trash2,
  AlertCircle,
  X,
  CheckCircle2,
} from 'lucide-react';

export default function StockInPage() {
  const [transactions, setTransactions] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  // Receipt Modal
  const [activeReceiptId, setActiveReceiptId] = useState<string | null>(null);

  // Record Stock In Modal
  const [isRecordOpen, setIsRecordOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Form State
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [type, setType] = useState<'NewStock' | 'WarehouseTransferIn'>('NewStock');
  const [sourceWarehouse, setSourceWarehouse] = useState('');
  const [items, setItems] = useState<{ productId: string; quantity: number }[]>([
    { productId: '', quantity: 10 },
  ]);

  const loadData = async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (searchTerm.trim()) params.search = searchTerm.trim();
      if (typeFilter) params.type = typeFilter;

      const txRes = await api.stockIn.list(params);
      setTransactions(txRes.data);

      const prodRes = await api.products.list({ status: 'Active' });
      setProducts(prodRes.data);
      if (prodRes.data.length > 0 && !items[0].productId) {
        setItems([{ productId: prodRes.data[0].id, quantity: 10 }]);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [searchTerm, typeFilter]);

  const handleAddItem = () => {
    const available = products.find((p) => !items.some((i) => i.productId === p.id));
    setItems([...items, { productId: available ? available.id : products[0]?.id || '', quantity: 10 }]);
  };

  const handleRemoveItem = (idx: number) => {
    if (items.length <= 1) return;
    setItems(items.filter((_, i) => i !== idx));
  };

  const handleItemChange = (idx: number, field: 'productId' | 'quantity', val: any) => {
    const updated = [...items];
    updated[idx] = { ...updated[idx], [field]: val };
    setItems(updated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    // Validate unique products in lines
    const pids = items.map((i) => i.productId).filter(Boolean);
    if (new Set(pids).size !== pids.length) {
      setFormError('Each product can appear at most once in a single Stock In.');
      return;
    }

    if (type === 'WarehouseTransferIn' && !sourceWarehouse.trim()) {
      setFormError('Source warehouse name is required for Warehouse Transfer In.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.stockIn.create({
        transactionDate: date,
        transactionType: type,
        sourceWarehouseName: type === 'WarehouseTransferIn' ? sourceWarehouse.trim() : undefined,
        items: items.map((i) => ({ productId: i.productId, quantity: Number(i.quantity) })),
      });

      setIsRecordOpen(false);
      loadData();

      // Automatically offer Receipt
      if (res.data?.receiptId) {
        setActiveReceiptId(res.data.receiptId);
      }
    } catch (err: any) {
      setFormError(err.message || 'Failed to record Stock In.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Stock In Records</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Record incoming stock (New Stock & Warehouse Transfers In) with immediate receipt generation
          </p>
        </div>

        <button
          onClick={() => {
            setFormError(null);
            setIsRecordOpen(true);
          }}
          className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors shrink-0"
        >
          <Plus className="w-4 h-4" /> Record Stock In
        </button>
      </div>

      {/* Filter Bar */}
      <div className="bg-white dark:bg-gray-900 p-4 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm flex flex-col sm:flex-row items-center gap-4">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search by SIN number or warehouse..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <span className="text-xs text-gray-500">Type:</span>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-xs text-gray-900 dark:text-white focus:outline-none"
          >
            <option value="">All Types</option>
            <option value="NewStock">New Stock</option>
            <option value="WarehouseTransferIn">Warehouse Transfer In</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-gray-50 dark:bg-gray-800/60 text-gray-600 dark:text-gray-400 border-b border-gray-200 dark:border-gray-800 font-semibold">
              <tr>
                <th className="py-3 px-4">Stock In #</th>
                <th className="py-3 px-4">Business Date</th>
                <th className="py-3 px-4">Type</th>
                <th className="py-3 px-4">Source Warehouse</th>
                <th className="py-3 px-4 text-right">Total Quantity</th>
                <th className="py-3 px-4 text-center">Version</th>
                <th className="py-3 px-4 text-right">Receipt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-gray-400">
                    Loading Stock In transactions...
                  </td>
                </tr>
              ) : transactions.length > 0 ? (
                transactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30">
                    <td className="py-3 px-4 font-mono font-bold text-gray-900 dark:text-white">
                      {tx.number}
                    </td>
                    <td className="py-3 px-4 text-gray-600 dark:text-gray-300">{tx.date}</td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded text-[10px] font-semibold ${
                          tx.type === 'WarehouseTransferIn'
                            ? 'bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400'
                            : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                        }`}
                      >
                        {tx.type === 'WarehouseTransferIn' ? 'Transfer In' : 'New Stock'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-gray-500">
                      {tx.sourceWarehouseName ? tx.sourceWarehouseName : '—'}
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-emerald-600 dark:text-emerald-400">
                      +{tx.totalQuantity} BOX
                      <span className="text-[10px] text-gray-400 font-normal ml-1">({tx.lineCount} lines)</span>
                    </td>
                    <td className="py-3 px-4 text-center font-mono text-gray-400">v{tx.version}</td>
                    <td className="py-3 px-4 text-right">
                      {tx.receiptId ? (
                        <button
                          onClick={() => setActiveReceiptId(tx.receiptId)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded text-[11px] font-medium transition-colors"
                        >
                          <FileText className="w-3.5 h-3.5 text-emerald-600" />
                          {tx.receiptNumber || 'Receipt'}
                        </button>
                      ) : (
                        <span className="text-gray-400 text-[11px]">—</span>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-gray-400">
                    No Stock In records found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* RECORD STOCK IN MODAL */}
      {isRecordOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-800 w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800">
              <div className="flex items-center gap-2">
                <ArrowDownToLine className="w-5 h-5 text-emerald-600" />
                <h3 className="font-bold text-gray-900 dark:text-white text-base">Record Stock In</h3>
              </div>
              <button onClick={() => setIsRecordOpen(false)} className="text-gray-400 hover:text-gray-600 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 overflow-y-auto flex-1 space-y-4 text-xs">
              {formError && (
                <div className="p-3 bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 rounded-lg flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    Business Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={date}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    Transaction Type *
                  </label>
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value as any)}
                    className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg"
                  >
                    <option value="NewStock">New Stock</option>
                    <option value="WarehouseTransferIn">Warehouse Transfer In</option>
                  </select>
                </div>
              </div>

              {type === 'WarehouseTransferIn' && (
                <div>
                  <label className="block font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    Source Warehouse Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Mombasa Central Depot"
                    value={sourceWarehouse}
                    onChange={(e) => setSourceWarehouse(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg"
                  />
                </div>
              )}

              {/* Items Section */}
              <div className="pt-2">
                <div className="flex items-center justify-between mb-2">
                  <label className="font-semibold text-gray-700 dark:text-gray-300">
                    Product Line Items (BOX) *
                  </label>
                  <button
                    type="button"
                    onClick={handleAddItem}
                    className="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1 hover:underline"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Product Line
                  </button>
                </div>

                <div className="space-y-2">
                  {items.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-3 p-2 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700">
                      <div className="flex-1">
                        <select
                          required
                          value={item.productId}
                          onChange={(e) => handleItemChange(idx, 'productId', e.target.value)}
                          className="w-full px-2.5 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg"
                        >
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.productName} (Current: {p.currentStock} BOX)
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="w-28">
                        <input
                          type="number"
                          min="1"
                          step="1"
                          required
                          value={item.quantity}
                          onChange={(e) => handleItemChange(idx, 'quantity', Number(e.target.value))}
                          placeholder="Qty BOX"
                          className="w-full px-2.5 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-right font-bold"
                        />
                      </div>

                      <button
                        type="button"
                        onClick={() => handleRemoveItem(idx)}
                        disabled={items.length === 1}
                        className="p-1.5 text-gray-400 hover:text-rose-600 disabled:opacity-30 rounded"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-4 flex items-center justify-end gap-2 border-t border-gray-100 dark:border-gray-800">
                <button
                  type="button"
                  onClick={() => setIsRecordOpen(false)}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold shadow-sm disabled:opacity-50"
                >
                  {submitting ? 'Posting...' : 'Commit Stock In & Generate Receipt'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* RECEIPT MODAL */}
      <ReceiptModal receiptId={activeReceiptId} onClose={() => setActiveReceiptId(null)} />
    </div>
  );
}
