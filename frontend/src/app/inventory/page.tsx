'use client';

import React, { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '../../lib/api';
import {
  Boxes,
  Plus,
  Search,
  Filter,
  AlertTriangle,
  Edit2,
  RotateCcw,
  History,
  X,
  CheckCircle2,
  AlertCircle,
  Eye,
} from 'lucide-react';

function InventoryContent() {
  const searchParams = useSearchParams();
  const initialLowStock = searchParams.get('lowStock') === 'true';

  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [lowStockFilter, setLowStockFilter] = useState(initialLowStock);

  // Modals state
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isCorrectOpeningOpen, setIsCorrectOpeningOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [productDetails, setProductDetails] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'details' | 'movements' | 'history'>('details');
  const [movements, setMovements] = useState<any[]>([]);
  const [editHistory, setEditHistory] = useState<any[]>([]);

  // Form states
  const [addForm, setAddForm] = useState({
    productName: '',
    minimumStock: 10,
    sellingPrice: '',
    status: 'Active',
    openingStock: 0,
  });

  const [editForm, setEditForm] = useState({
    productName: '',
    minimumStock: 0,
    sellingPrice: '',
    status: 'Active',
    reason: '',
  });

  const [openingCorrectionForm, setOpeningCorrectionForm] = useState({
    newQuantity: 0,
    reason: '',
  });

  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadProducts = () => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (searchTerm.trim()) params.search = searchTerm.trim();
    if (statusFilter !== 'All') params.status = statusFilter;
    if (lowStockFilter) params.lowStock = 'true';

    api.products
      .list(params)
      .then((res) => setProducts(res.data))
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadProducts();
  }, [searchTerm, statusFilter, lowStockFilter]);

  // Load product detail & sub-lists
  const openProductDetails = async (prod: any) => {
    setSelectedProduct(prod);
    setIsDetailsOpen(true);
    setActiveTab('details');

    try {
      const detailRes = await api.products.get(prod.id);
      setProductDetails(detailRes.data);
      const movesRes = await api.products.getMovements(prod.id);
      setMovements(movesRes.data);
      const histRes = await api.products.getEditHistory(prod.id);
      setEditHistory(histRes.data);
    } catch (e) {
      console.error(e);
    }
  };

  // Open Edit Modal
  const openEditModal = (prod: any) => {
    setSelectedProduct(prod);
    setEditForm({
      productName: prod.productName,
      minimumStock: prod.minimumStock,
      sellingPrice: prod.sellingPrice !== null ? String(prod.sellingPrice) : '',
      status: prod.status,
      reason: '',
    });
    setFormError(null);
    setIsEditOpen(true);
  };

  // Open Correct Opening Stock Modal
  const openCorrectOpeningModal = (prod: any) => {
    setSelectedProduct(prod);
    setOpeningCorrectionForm({
      newQuantity: prod.openingStock || 0,
      reason: '',
    });
    setFormError(null);
    setIsCorrectOpeningOpen(true);
  };

  // Handle Add Product Submit
  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);

    try {
      await api.products.create({
        productName: addForm.productName.trim(),
        minimumStock: Number(addForm.minimumStock),
        sellingPrice: addForm.sellingPrice ? Number(addForm.sellingPrice) : null,
        status: addForm.status,
        openingStock: Number(addForm.openingStock),
      });

      setIsAddOpen(false);
      setAddForm({ productName: '', minimumStock: 10, sellingPrice: '', status: 'Active', openingStock: 0 });
      loadProducts();
    } catch (err: any) {
      setFormError(err.message || 'Failed to create product.');
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Edit Product Submit
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editForm.reason.trim()) {
      setFormError('Reason is required when editing product details.');
      return;
    }

    setFormError(null);
    setSubmitting(true);

    try {
      await api.products.update(
        selectedProduct.id,
        {
          productName: editForm.productName.trim(),
          minimumStock: Number(editForm.minimumStock),
          sellingPrice: editForm.sellingPrice ? Number(editForm.sellingPrice) : null,
          status: editForm.status,
          reason: editForm.reason.trim(),
        },
        selectedProduct.rowVersion ? `"${selectedProduct.rowVersion}"` : undefined
      );

      setIsEditOpen(false);
      loadProducts();
    } catch (err: any) {
      setFormError(err.message || 'Failed to update product.');
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Correct Opening Stock Submit
  const handleCorrectOpeningSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!openingCorrectionForm.reason.trim()) {
      setFormError('Reason is mandatory for opening stock correction.');
      return;
    }

    setFormError(null);
    setSubmitting(true);

    try {
      await api.products.correctOpeningStock(selectedProduct.id, {
        newQuantity: Number(openingCorrectionForm.newQuantity),
        reason: openingCorrectionForm.reason.trim(),
      });

      setIsCorrectOpeningOpen(false);
      loadProducts();
    } catch (err: any) {
      setFormError(err.message || 'Failed to correct opening stock.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Product Inventory</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Manage product catalogue, opening stock, and live balances
          </p>
        </div>

        <button
          onClick={() => {
            setFormError(null);
            setIsAddOpen(true);
          }}
          className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors shrink-0"
        >
          <Plus className="w-4 h-4" /> Add Product
        </button>
      </div>

      {/* Filter Bar */}
      <div className="bg-white dark:bg-gray-900 p-4 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm flex flex-col sm:flex-row items-center gap-4">
        {/* Search */}
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search by product name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        {/* Status Filter */}
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <span className="text-xs text-gray-500">Status:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-xs text-gray-900 dark:text-white focus:outline-none"
          >
            <option value="All">All Statuses</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </select>
        </div>

        {/* Low Stock Filter Button */}
        <button
          onClick={() => setLowStockFilter(!lowStockFilter)}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border transition-colors w-full sm:w-auto justify-center ${
            lowStockFilter
              ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-400'
              : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'
          }`}
        >
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
          Low Stock Only
        </button>
      </div>

      {/* Inventory Table */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-gray-50 dark:bg-gray-800/60 text-gray-600 dark:text-gray-400 border-b border-gray-200 dark:border-gray-800 font-semibold">
              <tr>
                <th className="py-3 px-4">Product Name</th>
                <th className="py-3 px-4 text-right">Available Stock</th>
                <th className="py-3 px-4 text-right">Minimum Stock</th>
                <th className="py-3 px-4 text-right">Damaged Stock</th>
                <th className="py-3 px-4 text-right">Selling Price</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-gray-400">
                    Loading inventory catalogue...
                  </td>
                </tr>
              ) : products.length > 0 ? (
                products.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-900 dark:text-white">{p.productName}</span>
                        {p.isLowStock && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300">
                            LOW
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-gray-900 dark:text-white">
                      <span className={p.isLowStock ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}>
                        {p.currentStock} BOX
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right text-gray-600 dark:text-gray-300">
                      {p.minimumStock} BOX
                    </td>
                    <td className="py-3 px-4 text-right">
                      {p.damagedStock > 0 ? (
                        <span className="font-semibold text-rose-600 dark:text-rose-400">{p.damagedStock} BOX</span>
                      ) : (
                        <span className="text-gray-400">0</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right text-gray-600 dark:text-gray-300 font-mono">
                      {p.sellingPrice !== null ? `KES ${Number(p.sellingPrice).toFixed(2)}` : '—'}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                          p.status === 'Active'
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                            : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                        }`}
                      >
                        {p.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => openProductDetails(p)}
                          title="View Details & Ledger"
                          className="p-1.5 text-gray-500 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => openEditModal(p)}
                          title="Edit Product"
                          className="p-1.5 text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => openCorrectOpeningModal(p)}
                          title="Correct Opening Stock"
                          className="p-1.5 text-gray-500 hover:text-purple-600 dark:hover:text-purple-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-gray-400">
                    No products matching your search or filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL: ADD PRODUCT */}
      {isAddOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-800 w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800">
              <h3 className="font-bold text-gray-900 dark:text-white text-base">Add New Product</h3>
              <button onClick={() => setIsAddOpen(false)} className="text-gray-400 hover:text-gray-600 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddSubmit} className="p-6 space-y-4 text-xs">
              {formError && (
                <div className="p-3 bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 rounded-lg flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}

              <div>
                <label className="block font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  Product Name *
                </label>
                <input
                  type="text"
                  required
                  value={addForm.productName}
                  onChange={(e) => setAddForm({ ...addForm, productName: e.target.value })}
                  placeholder="e.g. Standard Cardboard Carton (Medium)"
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    Minimum Stock (BOX) *
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    required
                    value={addForm.minimumStock}
                    onChange={(e) => setAddForm({ ...addForm, minimumStock: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    Initial Opening Stock (BOX)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={addForm.openingStock}
                    onChange={(e) => setAddForm({ ...addForm, openingStock: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    Selling Price (KES, Optional)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="e.g. 150.00"
                    value={addForm.sellingPrice}
                    onChange={(e) => setAddForm({ ...addForm, sellingPrice: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    Status
                  </label>
                  <select
                    value={addForm.status}
                    onChange={(e) => setAddForm({ ...addForm, status: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </div>
              </div>

              <div className="pt-4 flex items-center justify-end gap-2 border-t border-gray-100 dark:border-gray-800">
                <button
                  type="button"
                  onClick={() => setIsAddOpen(false)}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold shadow-sm disabled:opacity-50"
                >
                  {submitting ? 'Creating...' : 'Save Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: EDIT PRODUCT */}
      {isEditOpen && selectedProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-800 w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800">
              <h3 className="font-bold text-gray-900 dark:text-white text-base">Edit Product</h3>
              <button onClick={() => setIsEditOpen(false)} className="text-gray-400 hover:text-gray-600 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="p-6 space-y-4 text-xs">
              {formError && (
                <div className="p-3 bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 rounded-lg flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}

              <div>
                <label className="block font-semibold text-gray-700 dark:text-gray-300 mb-1">Product Name</label>
                <input
                  type="text"
                  required
                  value={editForm.productName}
                  onChange={(e) => setEditForm({ ...editForm, productName: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-gray-700 dark:text-gray-300 mb-1">Minimum Stock (BOX)</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    required
                    value={editForm.minimumStock}
                    onChange={(e) => setEditForm({ ...editForm, minimumStock: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-gray-700 dark:text-gray-300 mb-1">Selling Price (KES)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={editForm.sellingPrice}
                    onChange={(e) => setEditForm({ ...editForm, sellingPrice: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-gray-700 dark:text-gray-300 mb-1">Status</label>
                <select
                  value={editForm.status}
                  onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg"
                >
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </div>

              <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-lg">
                <label className="block font-bold text-amber-900 dark:text-amber-200 mb-1">
                  Reason for Change * (Mandatory for audit trail)
                </label>
                <textarea
                  rows={2}
                  required
                  placeholder="Explain why this change is being made..."
                  value={editForm.reason}
                  onChange={(e) => setEditForm({ ...editForm, reason: e.target.value })}
                  className="w-full px-3 py-1.5 bg-white dark:bg-gray-800 border border-amber-300 dark:border-amber-700 rounded-lg focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div className="pt-4 flex items-center justify-end gap-2 border-t border-gray-100 dark:border-gray-800">
                <button
                  type="button"
                  onClick={() => setIsEditOpen(false)}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold shadow-sm disabled:opacity-50"
                >
                  {submitting ? 'Updating...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: CORRECT OPENING STOCK */}
      {isCorrectOpeningOpen && selectedProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-800 w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800">
              <h3 className="font-bold text-gray-900 dark:text-white text-base">
                Correct Opening Stock: {selectedProduct.productName}
              </h3>
              <button onClick={() => setIsCorrectOpeningOpen(false)} className="text-gray-400 hover:text-gray-600 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCorrectOpeningSubmit} className="p-6 space-y-4 text-xs">
              {formError && (
                <div className="p-3 bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 rounded-lg flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-xs space-y-1">
                <p>
                  <span className="text-gray-500">Current Available Stock:</span>{' '}
                  <span className="font-bold">{selectedProduct.currentStock} BOX</span>
                </p>
                <p>
                  <span className="text-gray-500">Effective Opening Stock:</span>{' '}
                  <span className="font-bold">{selectedProduct.openingStock} BOX</span>
                </p>
              </div>

              <div>
                <label className="block font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  New Opening Stock (BOX) *
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  required
                  value={openingCorrectionForm.newQuantity}
                  onChange={(e) => setOpeningCorrectionForm({ ...openingCorrectionForm, newQuantity: Number(e.target.value) })}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg"
                />
              </div>

              <div className="p-3 bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-900/50 rounded-lg">
                <label className="block font-bold text-purple-900 dark:text-purple-200 mb-1">
                  Reason for Opening Stock Correction *
                </label>
                <textarea
                  rows={2}
                  required
                  placeholder="e.g. Audit reconciliation adjustment"
                  value={openingCorrectionForm.reason}
                  onChange={(e) => setOpeningCorrectionForm({ ...openingCorrectionForm, reason: e.target.value })}
                  className="w-full px-3 py-1.5 bg-white dark:bg-gray-800 border border-purple-300 dark:border-purple-700 rounded-lg focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <div className="pt-4 flex items-center justify-end gap-2 border-t border-gray-100 dark:border-gray-800">
                <button
                  type="button"
                  onClick={() => setIsCorrectOpeningOpen(false)}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-semibold shadow-sm disabled:opacity-50"
                >
                  {submitting ? 'Posting...' : 'Apply Correction'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: PRODUCT DETAILS & LEDGER / EDIT HISTORY */}
      {isDetailsOpen && selectedProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-800 w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800">
              <div>
                <h3 className="font-bold text-gray-900 dark:text-white text-base">
                  {selectedProduct.productName}
                </h3>
                <span className="text-xs text-gray-500">Product Ledger & Audit History</span>
              </div>
              <button onClick={() => setIsDetailsOpen(false)} className="text-gray-400 hover:text-gray-600 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-200 dark:border-gray-800 px-6 bg-gray-50 dark:bg-gray-800/40 text-xs font-semibold">
              <button
                onClick={() => setActiveTab('details')}
                className={`py-3 px-4 border-b-2 transition-colors ${
                  activeTab === 'details'
                    ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                Stock Breakdown
              </button>
              <button
                onClick={() => setActiveTab('movements')}
                className={`py-3 px-4 border-b-2 transition-colors ${
                  activeTab === 'movements'
                    ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                Movement Ledger ({movements.length})
              </button>
              <button
                onClick={() => setActiveTab('history')}
                className={`py-3 px-4 border-b-2 transition-colors ${
                  activeTab === 'history'
                    ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                Edit History ({editHistory.length})
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto flex-1 text-xs">
              {activeTab === 'details' && (
                <div className="space-y-6">
                  {/* Stock Formulas Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div className="bg-gray-50 dark:bg-gray-800/60 p-3 rounded-lg border border-gray-100 dark:border-gray-800">
                      <span className="text-gray-400">Opening Stock:</span>
                      <p className="text-base font-bold text-gray-900 dark:text-white mt-0.5">
                        {productDetails?.openingStock ?? '...'} BOX
                      </p>
                    </div>
                    <div className="bg-emerald-50/50 dark:bg-emerald-950/20 p-3 rounded-lg border border-emerald-100 dark:border-emerald-900/40">
                      <span className="text-emerald-700 dark:text-emerald-400">Total Stock In:</span>
                      <p className="text-base font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                        +{productDetails?.totals?.stockIn ?? 0} BOX
                      </p>
                    </div>
                    <div className="bg-purple-50/50 dark:bg-purple-950/20 p-3 rounded-lg border border-purple-100 dark:border-purple-900/40">
                      <span className="text-purple-700 dark:text-purple-400">Total Stock Out:</span>
                      <p className="text-base font-bold text-purple-600 dark:text-purple-400 mt-0.5">
                        -{productDetails?.totals?.stockOut ?? 0} BOX
                      </p>
                    </div>
                    <div className="bg-gray-50 dark:bg-gray-800/60 p-3 rounded-lg border border-gray-100 dark:border-gray-800">
                      <span className="text-gray-400">Current Available:</span>
                      <p className="text-base font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                        {productDetails?.currentStock ?? '...'} BOX
                      </p>
                    </div>
                  </div>

                  {/* Secondary Totals */}
                  <div className="bg-gray-50 dark:bg-gray-800/40 p-4 rounded-xl border border-gray-100 dark:border-gray-800">
                    <h4 className="font-semibold text-gray-900 dark:text-white mb-3">Formula Ledger Components</h4>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      <div>
                        <span className="text-gray-400">Good Returns (+):</span>
                        <p className="font-semibold">+{productDetails?.totals?.returnsGood ?? 0} BOX</p>
                      </div>
                      <div>
                        <span className="text-gray-400">Damaged Returns:</span>
                        <p className="font-semibold text-rose-500">+{productDetails?.totals?.returnsDamaged ?? 0} BOX</p>
                      </div>
                      <div>
                        <span className="text-gray-400">Adjustments In (+):</span>
                        <p className="font-semibold">+{productDetails?.totals?.adjustmentsIn ?? 0} BOX</p>
                      </div>
                      <div>
                        <span className="text-gray-400">Adjustments Out (-):</span>
                        <p className="font-semibold text-rose-500">-{productDetails?.totals?.adjustmentsOut ?? 0} BOX</p>
                      </div>
                      <div>
                        <span className="text-gray-400">Marked as Good (+):</span>
                        <p className="font-semibold">+{productDetails?.totals?.markedAsGood ?? 0} BOX</p>
                      </div>
                      <div>
                        <span className="text-gray-400">Removed from Damaged:</span>
                        <p className="font-semibold text-rose-500">-{productDetails?.totals?.removedFromDamaged ?? 0} BOX</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'movements' && (
                <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 font-semibold border-b border-gray-200 dark:border-gray-800">
                      <tr>
                        <th className="py-2.5 px-3"># Seq</th>
                        <th className="py-2.5 px-3">Date</th>
                        <th className="py-2.5 px-3">Movement Type</th>
                        <th className="py-2.5 px-3 text-right">Δ Available</th>
                        <th className="py-2.5 px-3 text-right">Available After</th>
                        <th className="py-2.5 px-3 text-right">Δ Damaged</th>
                        <th className="py-2.5 px-3">Reason / Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {movements.map((m) => (
                        <tr key={m.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30">
                          <td className="py-2.5 px-3 font-mono text-gray-400">{m.sequenceNo}</td>
                          <td className="py-2.5 px-3">{m.date}</td>
                          <td className="py-2.5 px-3 font-medium">
                            <span className={m.isReversal ? 'text-rose-600 line-through' : ''}>
                              {m.movementType}
                            </span>
                            {m.isReversal && <span className="ml-1 text-[10px] text-rose-500">(Reversal)</span>}
                          </td>
                          <td
                            className={`py-2.5 px-3 text-right font-bold ${
                              m.deltaAvailable > 0
                                ? 'text-emerald-600'
                                : m.deltaAvailable < 0
                                ? 'text-rose-600'
                                : 'text-gray-400'
                            }`}
                          >
                            {m.deltaAvailable > 0 ? `+${m.deltaAvailable}` : m.deltaAvailable}
                          </td>
                          <td className="py-2.5 px-3 text-right font-semibold text-gray-900 dark:text-white">
                            {m.availableAfter} BOX
                          </td>
                          <td className="py-2.5 px-3 text-right text-gray-500">
                            {m.deltaDamaged !== 0 ? `${m.deltaDamaged > 0 ? '+' : ''}${m.deltaDamaged}` : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-gray-500 max-w-xs truncate">{m.reason || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {activeTab === 'history' && (
                <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 font-semibold border-b border-gray-200 dark:border-gray-800">
                      <tr>
                        <th className="py-2.5 px-3">Date (Nairobi)</th>
                        <th className="py-2.5 px-3">Field</th>
                        <th className="py-2.5 px-3">Old Value</th>
                        <th className="py-2.5 px-3">New Value</th>
                        <th className="py-2.5 px-3">Reason</th>
                        <th className="py-2.5 px-3">Admin</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {editHistory.map((h) => (
                        <tr key={h.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30">
                          <td className="py-2.5 px-3 text-gray-500">
                            {new Date(h.changedAtUtc).toLocaleString('en-GB', { timeZone: 'Africa/Nairobi' })}
                          </td>
                          <td className="py-2.5 px-3 font-semibold">{h.fieldName}</td>
                          <td className="py-2.5 px-3 text-rose-600 line-through">{h.oldValue ?? 'None'}</td>
                          <td className="py-2.5 px-3 text-emerald-600 font-medium">{h.newValue ?? 'None'}</td>
                          <td className="py-2.5 px-3 text-gray-600 dark:text-gray-300">{h.reason || '—'}</td>
                          <td className="py-2.5 px-3 text-gray-400">{h.admin}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3 bg-gray-50 dark:bg-gray-800/40 border-t border-gray-200 dark:border-gray-800 flex justify-end">
              <button
                onClick={() => setIsDetailsOpen(false)}
                className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-white rounded-lg text-xs font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function InventoryPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-xs text-gray-400">Loading inventory...</div>}>
      <InventoryContent />
    </Suspense>
  );
}
