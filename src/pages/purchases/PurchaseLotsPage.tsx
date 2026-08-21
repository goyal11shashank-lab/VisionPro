import React, { useState, useEffect } from 'react';
import {
  Layers,
  Search,
  RefreshCw,
  TrendingUp,
  Tag,
  Building2,
  Calendar,
  Eye,
  Filter,
} from 'lucide-react';
import { apiRequest } from '../../api/client.js';
import { PurchaseLot } from '../../types/index.js';

export const PurchaseLotsPage: React.FC = () => {
  const [lots, setLots] = useState<PurchaseLot[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState<string>('');

  const fetchLots = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest<{ lots: PurchaseLot[]; total: number }>('/api/purchases/lots?limit=100');
      setLots(data.lots || []);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch purchase lots');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLots();
  }, []);

  const filteredLots = lots.filter(lot => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      lot.uniqueItem?.name?.toLowerCase().includes(q) ||
      lot.uniqueItem?.code?.toLowerCase().includes(q) ||
      lot.batch?.barcode?.toLowerCase().includes(q) ||
      lot.invoice?.invoiceNumber?.toLowerCase().includes(q) ||
      lot.invoice?.supplier?.name?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6" id="purchase-lots-page-root">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-purple-50 text-purple-600 border border-purple-100">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Purchase Lots & Historical Costing</h1>
            <p className="text-sm text-slate-500">
              Audit granular purchase lots, landed unit rates, received dates, and batch-level stock depletion.
            </p>
          </div>
        </div>

        <button
          onClick={fetchLots}
          className="p-2.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
          title="Refresh Lots"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-between">
        <div className="relative w-full md:w-96">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search by SKU, barcode, invoice #, supplier..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-purple-500/20 focus:border-purple-600 transition-all"
          />
        </div>

        <div className="text-xs text-slate-500 font-medium">
          Showing <span className="font-bold text-slate-800">{filteredLots.length}</span> procurement lots
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="bg-slate-50/80 text-xs font-semibold text-slate-600 uppercase border-b border-slate-200">
              <tr>
                <th className="px-5 py-3.5">Item & Lens SKU</th>
                <th className="px-4 py-3.5">Optical Power Matrix</th>
                <th className="px-4 py-3.5">Purchase Invoice</th>
                <th className="px-4 py-3.5">Supplier</th>
                <th className="px-4 py-3.5 text-right">Unit Rate (₹)</th>
                <th className="px-4 py-3.5 text-right">Received Qty</th>
                <th className="px-4 py-3.5 text-right">Remaining Qty</th>
                <th className="px-5 py-3.5 text-right">Received Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <RefreshCw className="w-6 h-6 animate-spin text-purple-600" />
                      <span>Loading purchase lots...</span>
                    </div>
                  </td>
                </tr>
              ) : filteredLots.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <Layers className="w-8 h-8 text-slate-300" />
                      <span className="font-medium text-slate-600">No procurement lots found</span>
                      <p className="text-xs text-slate-400">
                        Purchase lots are automatically generated when a Purchase Invoice is POSTED.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredLots.map(lot => (
                  <tr key={lot.id} className="hover:bg-slate-50/60 transition-colors">
                    {/* Item */}
                    <td className="px-5 py-4">
                      <div className="font-semibold text-slate-900 text-xs">{lot.uniqueItem?.name}</div>
                      <div className="text-[11px] font-mono text-slate-400">{lot.uniqueItem?.code}</div>
                    </td>

                    {/* Powers */}
                    <td className="px-4 py-4">
                      {lot.batch ? (
                        <div className="text-xs font-mono font-medium text-purple-900 bg-purple-50 px-2 py-1 rounded-md inline-block">
                          SPH: {Number(lot.batch.sph) >= 0 ? `+${Number(lot.batch.sph).toFixed(2)}` : Number(lot.batch.sph).toFixed(2)}
                          {Number(lot.batch.cyl) !== 0 && ` | CYL: ${Number(lot.batch.cyl).toFixed(2)}`}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400 italic">Default</span>
                      )}
                      {lot.batch?.barcode && (
                        <div className="text-[10px] font-mono text-slate-400 mt-0.5">BC: {lot.batch.barcode}</div>
                      )}
                    </td>

                    {/* Invoice */}
                    <td className="px-4 py-4 text-xs font-mono text-purple-700 font-semibold">
                      {lot.invoice?.invoiceNumber || lot.purchaseInvoiceId}
                    </td>

                    {/* Supplier */}
                    <td className="px-4 py-4 text-xs text-slate-800">
                      {lot.invoice?.supplier?.name || '—'}
                    </td>

                    {/* Unit Rate */}
                    <td className="px-4 py-4 text-right font-mono font-semibold text-xs text-slate-900">
                      ₹{Number(lot.rate).toFixed(2)}
                    </td>

                    {/* Received */}
                    <td className="px-4 py-4 text-right font-mono font-bold text-xs text-slate-700">
                      {lot.quantityReceived} prs
                    </td>

                    {/* Remaining */}
                    <td className="px-4 py-4 text-right font-mono font-bold text-xs text-emerald-700">
                      {lot.remainingQuantity} prs
                    </td>

                    {/* Received Date */}
                    <td className="px-5 py-4 text-right text-xs text-slate-500">
                      {new Date(lot.receivedAt).toLocaleDateString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
