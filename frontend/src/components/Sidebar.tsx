'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Boxes,
  ArrowDownToLine,
  ArrowUpFromLine,
  ShoppingCart,
  RotateCcw,
  SlidersHorizontal,
  AlertTriangle,
  BarChart3,
  Search,
  ShieldCheck,
  Settings,
} from 'lucide-react';

const navItems = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Inventory', href: '/inventory', icon: Boxes },
  { name: 'Stock In', href: '/stock-in', icon: ArrowDownToLine },
  { name: 'Stock Out', href: '/stock-out', icon: ArrowUpFromLine },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 flex flex-col shrink-0 min-h-screen">
      {/* Brand */}
      <div className="h-16 flex items-center px-6 border-b border-gray-200 dark:border-gray-800 gap-3">
        <div className="w-9 h-9 rounded-lg bg-emerald-600 flex items-center justify-center text-white shadow-sm font-bold text-lg">
          PS
        </div>
        <div>
          <h1 className="font-bold text-gray-900 dark:text-white text-sm tracking-tight leading-none">Prime Stock</h1>
          <span className="text-[11px] text-gray-500 dark:text-gray-400 font-medium">Warehouse Engine</span>
        </div>
      </div>

      {/* Nav List */}
      <div className="flex-1 py-4 px-3 space-y-1">
        <div className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
          Core Modules (Phase 1)
        </div>
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-800/60'
              }`}
            >
              <Icon className={`w-5 h-5 ${isActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400'}`} />
              {item.name}
            </Link>
          );
        })}

        <div className="pt-6 px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
          Upcoming (Phase 2 & 3)
        </div>
        <div className="space-y-1 opacity-60">
          {[
            { name: 'Orders & Deliveries', icon: ShoppingCart },
            { name: 'Customer Returns', icon: RotateCcw },
            { name: 'Stock Adjustments', icon: SlidersHorizontal },
            { name: 'Damaged Stock', icon: AlertTriangle },
            { name: 'Reports & Analytics', icon: BarChart3 },
            { name: 'Audit & Edit History', icon: ShieldCheck },
            { name: 'Settings & Backups', icon: Settings },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.name}
                className="flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium text-gray-500 dark:text-gray-400 cursor-not-allowed"
              >
                <div className="flex items-center gap-3">
                  <Icon className="w-4 h-4 text-gray-400" />
                  {item.name}
                </div>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500">Next</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Warehouse Status Pill */}
      <div className="p-4 border-t border-gray-200 dark:border-gray-800">
        <div className="bg-gray-50 dark:bg-gray-800/50 p-3 rounded-lg border border-gray-100 dark:border-gray-800 text-xs">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="font-medium text-gray-800 dark:text-gray-200">Main Warehouse Active</span>
          </div>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">Unit: BOX • Currency: KES</p>
        </div>
      </div>
    </aside>
  );
}
