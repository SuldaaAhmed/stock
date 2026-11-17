'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../lib/api';
import {
  Boxes,
  Package,
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  RotateCcw,
  Clock,
  ArrowRight,
  TrendingDown,
} from 'lucide-react';

export default function DashboardPage() {
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const loadSummary = () => {
    setLoading(true);
    api.dashboard
      .getSummary()
      .then((res) => setSummary(res.data))
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadSummary();
  }, []);

  if (loading && !summary) {
    return <div className="p-8 text-center text-gray-500">Loading warehouse indicators...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Warehouse Overview</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Real-time stock indicators & transactional ledger status
          </p>
        </div>
        <button
          onClick={loadSummary}
          className="text-xs px-3 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg text-gray-600 dark:text-gray-300 transition-colors font-medium"
        >
          Refresh Indicators
        </button>
      </div>

      {/* Grid of Key Indicator Cards (1-7) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 1. Total Products */}
        <div className="bg-white dark:bg-gray-900 p-5 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">Total Active Products</span>
            <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
              {summary?.totalProducts || 0}
            </p>
            <span className="text-[11px] text-gray-400">Catalogue items</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 flex items-center justify-center">
            <Boxes className="w-5 h-5" />
          </div>
        </div>

        {/* 2. Total Stock */}
        <div className="bg-white dark:bg-gray-900 p-5 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">Total Available Stock</span>
            <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
              {summary?.totalStock || 0}{' '}
              <span className="text-xs font-normal text-gray-500 dark:text-gray-400">BOX</span>
            </p>
            <span className="text-[11px] text-gray-400">Ready for dispatch</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
            <Package className="w-5 h-5" />
          </div>
        </div>

        {/* 3. Low Stock Count */}
        <div className="bg-white dark:bg-gray-900 p-5 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">Low Stock Warnings</span>
            <p className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-1">
              {summary?.lowStock?.count || 0}
            </p>
            <span className="text-[11px] text-gray-400">At or below minimum</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5" />
          </div>
        </div>

        {/* 4. Damaged Stock */}
        <div className="bg-white dark:bg-gray-900 p-5 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">Damaged Stock</span>
            <p className="text-2xl font-bold text-rose-600 dark:text-rose-400 mt-1">
              {summary?.damagedStock || 0}{' '}
              <span className="text-xs font-normal text-gray-500 dark:text-gray-400">BOX</span>
            </p>
            <span className="text-[11px] text-gray-400">Held in quarantine</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 flex items-center justify-center">
            <TrendingDown className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Today's Transactions Summary (5, 6, 7) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Today's Stock In */}
        <div className="bg-white dark:bg-gray-900 p-4 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm flex items-center gap-4">
          <div className="w-11 h-11 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
            <ArrowDownToLine className="w-6 h-6" />
          </div>
          <div>
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Today&apos;s Stock In</span>
            <div className="flex items-baseline gap-2 mt-0.5">
              <span className="text-lg font-bold text-gray-900 dark:text-white">
                {summary?.todayStockIn?.quantity || 0} BOX
              </span>
              <span className="text-xs text-gray-400">({summary?.todayStockIn?.transactions || 0} batches)</span>
            </div>
          </div>
        </div>

        {/* Today's Stock Out */}
        <div className="bg-white dark:bg-gray-900 p-4 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm flex items-center gap-4">
          <div className="w-11 h-11 rounded-xl bg-purple-50 dark:bg-purple-950/50 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0">
            <ArrowUpFromLine className="w-6 h-6" />
          </div>
          <div>
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Today&apos;s Stock Out</span>
            <div className="flex items-baseline gap-2 mt-0.5">
              <span className="text-lg font-bold text-gray-900 dark:text-white">
                {summary?.todayStockOut?.quantity || 0} BOX
              </span>
              <span className="text-xs text-gray-400">({summary?.todayStockOut?.transactions || 0} dispatches)</span>
            </div>
          </div>
        </div>

        {/* Today's Returns */}
        <div className="bg-white dark:bg-gray-900 p-4 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm flex items-center gap-4">
          <div className="w-11 h-11 rounded-xl bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
            <RotateCcw className="w-6 h-6" />
          </div>
          <div>
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Today&apos;s Returns</span>
            <div className="flex items-baseline gap-2 mt-0.5">
              <span className="text-lg font-bold text-gray-900 dark:text-white">
                {summary?.todayReturns?.quantity || 0} BOX
              </span>
              <span className="text-xs text-gray-400">({summary?.todayReturns?.transactions || 0} returns)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Two Column Layout: Low Stock Alert Table & Recent Transactions (Indicator 3 & 8) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Low Stock Items List */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden flex flex-col">
          <div className="p-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <h3 className="text-sm font-bold text-gray-900 dark:text-white">Low Stock Warning List</h3>
            </div>
            <Link
              href="/inventory?lowStock=true"
              className="text-xs text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 flex items-center gap-1 font-medium"
            >
              View Inventory <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="p-0 overflow-x-auto flex-1">
            {summary?.lowStock?.items && summary.lowStock.items.length > 0 ? (
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 dark:bg-gray-800/50 text-gray-600 dark:text-gray-400 border-b border-gray-200 dark:border-gray-800">
                  <tr>
                    <th className="py-2.5 px-4 font-semibold">Product Name</th>
                    <th className="py-2.5 px-4 text-right font-semibold">Available</th>
                    <th className="py-2.5 px-4 text-right font-semibold">Min Stock</th>
                    <th className="py-2.5 px-4 text-center font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {summary.lowStock.items.map((item: any) => (
                    <tr key={item.productId} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30">
                      <td className="py-2.5 px-4 font-medium text-gray-900 dark:text-white">
                        {item.productName}
                      </td>
                      <td className="py-2.5 px-4 text-right font-bold text-rose-600 dark:text-rose-400">
                        {item.currentQuantity} BOX
                      </td>
                      <td className="py-2.5 px-4 text-right text-gray-500 dark:text-gray-400">
                        {item.minimumQuantity} BOX
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400">
                          Shortage: {item.minimumQuantity - item.currentQuantity}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="py-12 text-center text-xs text-gray-400">
                All active products are currently above their minimum stock thresholds.
              </div>
            )}
          </div>
        </div>

        {/* Recent 10 Transactions (Indicator 8) */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden flex flex-col">
          <div className="p-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-gray-500" />
              <h3 className="text-sm font-bold text-gray-900 dark:text-white">Recent Transactions</h3>
            </div>
            <span className="text-[11px] text-gray-400">Latest 10 activities</span>
          </div>

          <div className="divide-y divide-gray-100 dark:divide-gray-800 overflow-y-auto max-h-[380px]">
            {summary?.recentTransactions && summary.recentTransactions.length > 0 ? (
              summary.recentTransactions.map((tx: any, idx: number) => {
                const isStockIn = tx.type === 'StockIn';
                return (
                  <div key={idx} className="p-3.5 hover:bg-gray-50/50 dark:hover:bg-gray-800/30 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                          isStockIn
                            ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400'
                            : 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400'
                        }`}
                      >
                        {isStockIn ? <ArrowDownToLine className="w-3.5 h-3.5" /> : <ArrowUpFromLine className="w-3.5 h-3.5" />}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-gray-900 dark:text-white font-mono">{tx.number}</span>
                          <span className="text-[10px] text-gray-400 font-medium">({tx.type})</span>
                        </div>
                        <p className="text-gray-500 text-[11px] mt-0.5">{tx.summary}</p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-[11px] text-gray-500 font-medium">{tx.date}</span>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="py-12 text-center text-xs text-gray-400">No transactions recorded yet.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
