import React, { useEffect, useRef } from 'react';
import { Search, X, Plus, Layers, Users, Package, Eye, AlertCircle } from 'lucide-react';

export interface ContextualPanelItem {
  id: string;
  title: string;
  subtitle?: string;
  code?: string;
  badge?: string;
  badgeColor?: 'blue' | 'emerald' | 'purple' | 'amber' | 'slate';
  rightText?: string;
  rightSubText?: string;
  meta?: any;
}

export interface TallyContextualPanelProps {
  isOpen: boolean;
  type: 'PARTY' | 'STOCK_ITEM' | 'BATCH' | null;
  title: string;
  subtitle?: string;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  items: ContextualPanelItem[];
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
  onConfirmSelect: (item: ContextualPanelItem) => void;
  onCreateNew?: () => void;
  createLabel?: string;
  onClose: () => void;
  isSales?: boolean;
}

export const TallyContextualPanel: React.FC<TallyContextualPanelProps> = ({
  isOpen,
  type,
  title,
  subtitle,
  searchQuery,
  onSearchChange,
  items,
  selectedIndex,
  onSelectIndex,
  onConfirmSelect,
  onCreateNew,
  createLabel,
  onClose,
  isSales = true,
}) => {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Keep highlighted item visible inside scrolling container
  useEffect(() => {
    if (selectedIndex >= 0 && itemRefs.current[selectedIndex]) {
      itemRefs.current[selectedIndex]?.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth',
      });
    }
  }, [selectedIndex]);

  if (!isOpen || !type) return null;

  const defaultCreateLabel =
    createLabel ||
    (type === 'PARTY'
      ? isSales
        ? '+ Create Customer'
        : '+ Create Supplier'
      : type === 'STOCK_ITEM'
      ? '+ Create Stock Item'
      : '+ Create Batch');

  return (
    <aside
      id="tally-contextual-panel"
      aria-label={title}
      className="fixed inset-y-0 right-0 z-40 w-80 sm:w-88 md:w-96 lg:static lg:w-84 xl:w-96 shrink-0 bg-white border-l border-slate-300 shadow-xl lg:shadow-none flex flex-col h-full overflow-hidden select-none animate-in slide-in-from-right-3 duration-150"
    >
      {/* 1. Panel Header Bar (Tally-Style Navy Header) */}
      <div className="bg-[#0f2e54] text-white px-3 py-2 flex items-center justify-between border-b border-blue-950 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {type === 'PARTY' ? (
            <Users className="w-4 h-4 text-cyan-400 shrink-0" />
          ) : type === 'STOCK_ITEM' ? (
            <Package className="w-4 h-4 text-cyan-400 shrink-0" />
          ) : (
            <Layers className="w-4 h-4 text-cyan-400 shrink-0" />
          )}
          <div className="min-w-0">
            <h2 className="text-xs font-black tracking-wide uppercase truncate font-sans text-cyan-100">
              {title}
            </h2>
            {subtitle && (
              <p className="text-[10px] text-cyan-300/80 font-mono truncate">
                {subtitle}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {onCreateNew && (
            <button
              type="button"
              onClick={onCreateNew}
              className="px-2 py-0.5 text-[11px] font-bold text-white bg-blue-600 hover:bg-blue-500 rounded border border-blue-400/50 shadow-2xs transition-colors flex items-center gap-1 cursor-pointer"
              title="Create New (Alt+C)"
            >
              <Plus className="w-3 h-3" />
              <span>Create</span>
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-300 hover:text-white hover:bg-white/10 rounded transition-colors cursor-pointer"
            title="Close Panel (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 2. Fast Instant Search Input */}
      <div className="p-2 bg-slate-100 border-b border-slate-300 shrink-0">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-2 pointer-events-none" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={e => onSearchChange(e.target.value)}
            placeholder={
              type === 'PARTY'
                ? 'Search party name / phone...'
                : type === 'STOCK_ITEM'
                ? 'Search stock item / code...'
                : 'Filter batches / powers...'
            }
            className="w-full pl-7 pr-6 py-1 text-xs font-bold text-slate-900 bg-white border border-slate-400 rounded focus:outline-none focus:ring-1 focus:ring-blue-600 focus:border-blue-600 placeholder:text-slate-400 placeholder:font-normal font-sans shadow-2xs"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              className="absolute right-2 top-1.5 text-slate-400 hover:text-slate-700"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <div className="flex items-center justify-between mt-1 text-[10px] text-slate-500 font-mono">
          <span>{items.length} records found</span>
          <span>[↑/↓] Navigate • [Enter] Select</span>
        </div>
      </div>

      {/* 3. Items List Container */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto divide-y divide-slate-100 custom-scrollbar bg-slate-50/50"
      >
        {items.length > 0 ? (
          items.map((item, idx) => {
            const isSelected = idx === selectedIndex;
            return (
              <button
                key={item.id}
                ref={el => {
                  itemRefs.current[idx] = el;
                }}
                type="button"
                onClick={() => onConfirmSelect(item)}
                onMouseEnter={() => onSelectIndex(idx)}
                className={`w-full text-left p-2 transition-colors cursor-pointer flex items-start justify-between gap-2 border-l-4 ${
                  isSelected
                    ? 'bg-blue-600 text-white border-blue-900 shadow-xs'
                    : 'hover:bg-blue-50/80 text-slate-900 border-transparent bg-white'
                }`}
              >
                {/* Left content: Title & details */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span
                      className={`text-xs font-bold truncate font-sans ${
                        isSelected ? 'text-white font-extrabold' : 'text-slate-900'
                      }`}
                    >
                      {item.title}
                    </span>
                    {item.badge && (
                      <span
                        className={`px-1.5 py-0.2 rounded text-[10px] font-mono font-bold shrink-0 uppercase ${
                          isSelected
                            ? 'bg-white/20 text-white'
                            : item.badgeColor === 'blue'
                            ? 'bg-blue-100 text-blue-800 border border-blue-200'
                            : item.badgeColor === 'purple'
                            ? 'bg-purple-100 text-purple-800 border border-purple-200'
                            : item.badgeColor === 'amber'
                            ? 'bg-amber-100 text-amber-800 border border-amber-200'
                            : 'bg-slate-200 text-slate-800 border border-slate-300'
                        }`}
                      >
                        {item.badge}
                      </span>
                    )}
                  </div>

                  {item.code && (
                    <div
                      className={`text-[10px] font-mono mt-0.5 truncate ${
                        isSelected ? 'text-blue-100' : 'text-slate-500'
                      }`}
                    >
                      {item.code}
                    </div>
                  )}

                  {item.subtitle && (
                    <div
                      className={`text-[11px] truncate mt-0.5 font-sans ${
                        isSelected ? 'text-blue-100/90' : 'text-slate-600'
                      }`}
                    >
                      {item.subtitle}
                    </div>
                  )}
                </div>

                {/* Right content: Numeric, Rates, or Balances */}
                {(item.rightText || item.rightSubText) && (
                  <div className="text-right shrink-0 font-mono">
                    {item.rightText && (
                      <div
                        className={`text-xs font-bold ${
                          isSelected ? 'text-white' : 'text-slate-900'
                        }`}
                      >
                        {item.rightText}
                      </div>
                    )}
                    {item.rightSubText && (
                      <div
                        className={`text-[10px] ${
                          isSelected ? 'text-blue-100' : 'text-slate-500'
                        }`}
                      >
                        {item.rightSubText}
                      </div>
                    )}
                  </div>
                )}
              </button>
            );
          })
        ) : (
          <div className="p-6 text-center text-slate-500 space-y-3">
            <Layers className="w-8 h-8 text-slate-300 mx-auto" />
            <div>
              <p className="text-xs font-semibold text-slate-700">No matching records</p>
              {searchQuery && (
                <p className="text-[11px] text-slate-500 mt-0.5">
                  No results found for &ldquo;{searchQuery}&rdquo;
                </p>
              )}
            </div>
            {onCreateNew && (
              <button
                type="button"
                onClick={onCreateNew}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded shadow-xs cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{defaultCreateLabel}</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* 4. Panel Footer Status Bar */}
      <div className="bg-slate-200 text-slate-700 px-3 py-1.5 border-t border-slate-300 text-[10px] font-mono flex items-center justify-between shrink-0">
        <span className="font-bold text-slate-800">Tally Selection View</span>
        <span className="text-slate-500">Esc to dismiss</span>
      </div>
    </aside>
  );
};
