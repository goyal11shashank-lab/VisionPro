import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
  Barcode,
  FileText,
  Users,
  Package,
  ArrowRight,
  X,
  ExternalLink,
  ShieldAlert,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { apiRequest } from '../../api/client.js';

interface SearchResultItem {
  id: string;
  type: string;
  title: string;
  subtitle: string;
  badge?: string;
  status?: string;
  linkPath: string;
  details?: Record<string, any>;
}

interface GlobalSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (path: string) => void;
}

export const GlobalSearchModal: React.FC<GlobalSearchModalProps> = ({
  isOpen,
  onClose,
  onNavigate,
}) => {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'BARCODE' | 'DOCUMENT' | 'PARTY' | 'PRODUCT'>('ALL');
  const [results, setResults] = useState<{
    barcodes: any[];
    documents: any[];
    parties: any[];
    products: any[];
  }>({
    barcodes: [],
    documents: [],
    parties: [],
    products: [],
  });

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery('');
      setResults({ barcodes: [], documents: [], parties: [], products: [] });
    }
  }, [isOpen]);

  // Global Ctrl+K / Cmd+K listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (isOpen) {
          onClose();
        } else {
          // Open handled by parent or state
        }
      }
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Debounced search
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed || trimmed.length < 2) {
      setResults({ barcodes: [], documents: [], parties: [], products: [] });
      setLoading(false);
      return;
    }

    setLoading(true);
    const handler = setTimeout(async () => {
      try {
        const res = await apiRequest(`/api/search?q=${encodeURIComponent(trimmed)}`);
        if (res.success) {
          setResults({
            barcodes: res.barcodes || [],
            documents: res.documents || [],
            parties: res.parties || [],
            products: res.products || [],
          });
        }
      } catch (err) {
        console.error('Search query failed', err);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => clearTimeout(handler);
  }, [query]);

  if (!isOpen) return null;

  const totalResults =
    results.barcodes.length +
    results.documents.length +
    results.parties.length +
    results.products.length;

  const handleSelect = (path: string) => {
    onNavigate(path);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[80vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Search Header Input */}
        <div className="p-4 border-b border-slate-100 flex items-center gap-3 bg-slate-50/50">
          <Search className="w-5 h-5 text-blue-600 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search by Barcode, Invoice #, Customer/Supplier name, Mobile, SKU, or Brand..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="flex-1 bg-transparent border-none text-slate-800 placeholder:text-slate-400 focus:outline-hidden text-sm font-medium"
          />
          {loading && <Loader2 className="w-4 h-4 text-blue-600 animate-spin shrink-0" />}
          {query && (
            <button
              onClick={() => setQuery('')}
              className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-200/50"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <kbd className="hidden sm:inline-block px-2 py-0.5 text-[10px] font-semibold text-slate-500 bg-slate-200/70 border border-slate-300 rounded-md">
            ESC
          </kbd>
        </div>

        {/* Filter Pills */}
        <div className="px-4 py-2 border-b border-slate-100 bg-white flex items-center gap-1.5 overflow-x-auto text-xs">
          <button
            onClick={() => setActiveFilter('ALL')}
            className={`px-3 py-1 rounded-lg font-medium transition-colors ${
              activeFilter === 'ALL'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            All Results ({totalResults})
          </button>
          <button
            onClick={() => setActiveFilter('BARCODE')}
            className={`px-3 py-1 rounded-lg font-medium transition-colors flex items-center gap-1.5 ${
              activeFilter === 'BARCODE'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <Barcode className="w-3.5 h-3.5" />
            Barcodes ({results.barcodes.length})
          </button>
          <button
            onClick={() => setActiveFilter('DOCUMENT')}
            className={`px-3 py-1 rounded-lg font-medium transition-colors flex items-center gap-1.5 ${
              activeFilter === 'DOCUMENT'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            Invoices & Orders ({results.documents.length})
          </button>
          <button
            onClick={() => setActiveFilter('PARTY')}
            className={`px-3 py-1 rounded-lg font-medium transition-colors flex items-center gap-1.5 ${
              activeFilter === 'PARTY'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            Parties ({results.parties.length})
          </button>
          <button
            onClick={() => setActiveFilter('PRODUCT')}
            className={`px-3 py-1 rounded-lg font-medium transition-colors flex items-center gap-1.5 ${
              activeFilter === 'PRODUCT'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <Package className="w-3.5 h-3.5" />
            Products ({results.products.length})
          </button>
        </div>

        {/* Results List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-4 divide-y divide-slate-100">
          {query.trim().length < 2 ? (
            <div className="py-12 text-center text-slate-400 space-y-2">
              <Search className="w-8 h-8 mx-auto text-slate-300 stroke-1" />
              <p className="text-sm font-medium">Type at least 2 characters to start global search</p>
              <p className="text-xs text-slate-400">
                Instantly matches Barcodes, Sales Invoices, Purchase Invoices, Customers, Suppliers, and SKUs.
              </p>
            </div>
          ) : totalResults === 0 && !loading ? (
            <div className="py-12 text-center text-slate-400 space-y-2">
              <AlertCircle className="w-8 h-8 mx-auto text-amber-400 stroke-1" />
              <p className="text-sm font-medium text-slate-700">No matching records found for "{query}"</p>
              <p className="text-xs text-slate-400">Check spelling or try searching by code, mobile, or barcode.</p>
            </div>
          ) : (
            <>
              {/* 1. Barcodes / Batches */}
              {(activeFilter === 'ALL' || activeFilter === 'BARCODE') && results.barcodes.length > 0 && (
                <div className="pt-2 first:pt-0 space-y-1.5">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 px-2 flex items-center gap-1.5">
                    <Barcode className="w-3.5 h-3.5 text-blue-600" />
                    Optical Batches & Barcodes ({results.barcodes.length})
                  </div>
                  {results.barcodes.map(b => (
                    <div
                      key={b.id}
                      onClick={() => handleSelect('/master/batches')}
                      className="p-2.5 rounded-xl hover:bg-blue-50/70 border border-slate-100 hover:border-blue-200 transition-all cursor-pointer flex items-center justify-between group"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center font-mono text-xs font-bold shrink-0">
                          <Barcode className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-slate-900 text-xs">{b.barcode}</span>
                            <span className="text-xs font-medium text-slate-700 truncate">{b.product_name}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600 font-semibold">
                              {b.category_name}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
                            <span>Power: SPH {b.sph} | CYL {b.cyl} | AXIS {b.axis}</span>
                            <span>•</span>
                            <span className={b.physical_stock > 0 ? 'text-emerald-600 font-semibold' : 'text-rose-600 font-semibold'}>
                              Stock: {b.physical_stock} (Avail: {b.available_stock})
                            </span>
                          </div>
                        </div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-blue-600 group-hover:translate-x-0.5 transition-all shrink-0" />
                    </div>
                  ))}
                </div>
              )}

              {/* 2. Documents (Sales & Purchase Invoices / Orders) */}
              {(activeFilter === 'ALL' || activeFilter === 'DOCUMENT') && results.documents.length > 0 && (
                <div className="pt-2 first:pt-0 space-y-1.5">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 px-2 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-indigo-600" />
                    Invoices & Documents ({results.documents.length})
                  </div>
                  {results.documents.map(d => {
                    const navPath =
                      d.type === 'SALES_INVOICE'
                        ? '/sales/invoices'
                        : d.type === 'PURCHASE_INVOICE'
                        ? '/purchase/invoices'
                        : d.type === 'SALES_RETURN'
                        ? '/sales/returns'
                        : d.type === 'PURCHASE_RETURN'
                        ? '/purchase/returns'
                        : '/sales/orders';

                    return (
                      <div
                        key={`${d.type}-${d.id}`}
                        onClick={() => handleSelect(navPath)}
                        className="p-2.5 rounded-xl hover:bg-indigo-50/70 border border-slate-100 hover:border-indigo-200 transition-all cursor-pointer flex items-center justify-between group"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center font-mono text-xs font-bold shrink-0">
                            <FileText className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-slate-900 text-xs">{d.doc_number}</span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-indigo-100 text-indigo-700 font-bold uppercase">
                                {d.type.replace('_', ' ')}
                              </span>
                              <span
                                className={`text-[10px] px-1.5 py-0.5 rounded-md font-semibold ${
                                  d.status === 'POSTED' || d.status === 'CONFIRMED'
                                    ? 'bg-emerald-100 text-emerald-700'
                                    : 'bg-amber-100 text-amber-700'
                                }`}
                              >
                                {d.status}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
                              <span>Party: <strong className="text-slate-700">{d.party_name}</strong></span>
                              <span>•</span>
                              <span>Date: {d.doc_date ? new Date(d.doc_date).toLocaleDateString() : 'N/A'}</span>
                              <span>•</span>
                              <span className="font-bold text-slate-900">₹{Number(d.grand_total || 0).toLocaleString()}</span>
                            </div>
                          </div>
                        </div>
                        <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-indigo-600 group-hover:translate-x-0.5 transition-all shrink-0" />
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 3. Parties */}
              {(activeFilter === 'ALL' || activeFilter === 'PARTY') && results.parties.length > 0 && (
                <div className="pt-2 first:pt-0 space-y-1.5">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 px-2 flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-emerald-600" />
                    Customers & Suppliers ({results.parties.length})
                  </div>
                  {results.parties.map(p => (
                    <div
                      key={p.id}
                      onClick={() => handleSelect(p.party_type === 'SUPPLIER' ? '/parties/suppliers' : '/parties/customers')}
                      className="p-2.5 rounded-xl hover:bg-emerald-50/70 border border-slate-100 hover:border-emerald-200 transition-all cursor-pointer flex items-center justify-between group"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-mono text-xs font-bold shrink-0">
                          <Users className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900 text-xs">{p.name}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600 font-semibold">
                              {p.party_code}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-emerald-100 text-emerald-700 font-bold uppercase">
                              {p.party_type}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
                            <span>Mobile: {p.mobile || 'N/A'}</span>
                            {p.gstin && <span>• GSTIN: {p.gstin}</span>}
                            {p.city && <span>• {p.city}</span>}
                          </div>
                        </div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-emerald-600 group-hover:translate-x-0.5 transition-all shrink-0" />
                    </div>
                  ))}
                </div>
              )}

              {/* 4. Products */}
              {(activeFilter === 'ALL' || activeFilter === 'PRODUCT') && results.products.length > 0 && (
                <div className="pt-2 first:pt-0 space-y-1.5">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 px-2 flex items-center gap-1.5">
                    <Package className="w-3.5 h-3.5 text-amber-600" />
                    Catalog Products ({results.products.length})
                  </div>
                  {results.products.map(pr => (
                    <div
                      key={pr.id}
                      onClick={() => handleSelect('/master/unique-items')}
                      className="p-2.5 rounded-xl hover:bg-amber-50/70 border border-slate-100 hover:border-amber-200 transition-all cursor-pointer flex items-center justify-between group"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center font-mono text-xs font-bold shrink-0">
                          <Package className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900 text-xs">{pr.name}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600 font-mono">
                              SKU: {pr.sku}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-700 font-bold">
                              {pr.category_name}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
                            <span>Brand: {pr.brand_name}</span>
                            <span>•</span>
                            <span className="font-bold text-slate-800">MRP: ₹{Number(pr.mrp || 0).toLocaleString()}</span>
                          </div>
                        </div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-amber-600 group-hover:translate-x-0.5 transition-all shrink-0" />
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer info */}
        <div className="p-3 border-t border-slate-100 bg-slate-50/70 text-slate-500 text-[11px] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span>Navigation:</span>
            <kbd className="px-1.5 py-0.5 rounded bg-slate-200/80 font-mono text-[10px]">Click result to jump</kbd>
          </div>
          <div className="text-slate-400">
            Powered by PostgreSQL Fast Pattern Search
          </div>
        </div>
      </div>
    </div>
  );
};
