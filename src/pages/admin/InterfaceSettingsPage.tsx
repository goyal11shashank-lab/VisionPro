import React, { useState } from 'react';
import { MousePointerClick, Columns3, Printer, ShieldCheck, RefreshCw } from 'lucide-react';
import { useBusinessSettings } from '../../context/BusinessSettingsContext.js';

/**
 * Interface & Printing settings.
  * Super Admin only (route guard in App.tsx and requireSuperAdmin on the server).
   * Controls the owner-requested UI behaviours; all are display/behaviour toggles,
    * never data changes.
     */
export const InterfaceSettingsPage: React.FC = () => {
    const { settings, updateSettings, saving, error, refreshSettings } = useBusinessSettings();
    const [savedNote, setSavedNote] = useState<string | null>(null);
  
    const rightClickRowActions = settings?.ui?.rightClickRowActions ?? true;
    const hideStockItemMasterColumns = settings?.ui?.hideStockItemMasterColumns ?? true;
    const a5Orientation = (settings?.print?.defaultOrientation ?? 'PORTRAIT').toUpperCase() === import React, { useState } from 'react';
import { MousePointerClick, Columns3, Printer, ShieldCheck, RefreshCw } from 'lucide-react';
import { useBusinessSettings } from '../../context/BusinessSettingsContext.js';

/**
 * Interface & Printing settings.
 * Super Admin only (route guard in App.tsx and requireSuperAdmin on the server).
 * Controls the owner-requested UI behaviours; all are display/behaviour toggles,
 * never data changes.
 */
export const InterfaceSettingsPage: React.FC = () => {
  const { settings, updateSettings, saving, error, refreshSettings } = useBusinessSettings();
  const [savedNote, setSavedNote] = useState<string | null>(null);

  const rightClickRowActions = settings?.ui?.rightClickRowActions ?? true;
  const hideStockItemMasterColumns = settings?.ui?.hideStockItemMasterColumns ?? true;
  const a5Orientation = (settings?.print?.defaultOrientation ?? 'PORTRAIT').toUpperCase() === 'LANDSCAPE' ? 'LANDSCAPE' : 'PORTRAIT';

  const save = async (partial: Parameters<typeof updateSettings>[0], note: string) => {
    setSavedNote(null);
    const ok = await updateSettings(partial);
    if (ok) {
      setSavedNote(note);
      await refreshSettings();
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-indigo-600/10 text-indigo-600 border border-indigo-200">
          <ShieldCheck className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">Interface & Printing Settings</h1>
          <p className="text-xs text-slate-500">Super Administrator only. These controls change display behaviour, never data.</p>
        </div>
      </div>

      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-2">{error}</div>}
      {savedNote && <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2">{savedNote}</div>}

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm divide-y divide-slate-100">
        <div className="flex items-center justify-between gap-4 p-5">
          <div className="flex items-start gap-3">
            <MousePointerClick className="h-5 w-5 text-slate-500 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-slate-800">Right-click row actions</p>
              <p className="text-xs text-slate-500 mt-0.5">
                On every list page (stock items, parties, sales, purchases and more), the Actions column is hidden and
                right-clicking a row shows its actions instead. Turn off to bring back the always-visible Actions column.
              </p>
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={rightClickRowActions}
              disabled={saving}
              onChange={(e) => save({ ui: { ...settings.ui, rightClickRowActions: e.target.checked } }, 'Right-click row actions preference saved.')}
            />
            <div className="w-11 h-6 bg-slate-200 peer-checked:bg-indigo-600 rounded-full after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-5" />
          </label>
        </div>

        <div className="flex items-center justify-between gap-4 p-5">
          <div className="flex items-start gap-3">
            <Columns3 className="h-5 w-5 text-slate-500 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-slate-800">Hide extra Stock Items columns</p>
              <p className="text-xs text-slate-500 mt-0.5">
                On the Stock Items master, hides the SKU Code, Primary Item, Category and GST Rate columns.
                Display-only; the underlying data stays intact and exports are unaffected.
              </p>
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={hideStockItemMasterColumns}
              disabled={saving}
              onChange={(e) => save({ ui: { ...settings.ui, hideStockItemMasterColumns: e.target.checked } }, 'Stock Items column preference saved.')}
            />
            <div className="w-11 h-6 bg-slate-200 peer-checked:bg-indigo-600 rounded-full after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-5" />
          </label>
        </div>

        <div className="flex items-center justify-between gap-4 p-5">
          <div className="flex items-start gap-3">
            <Printer className="h-5 w-5 text-slate-500 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-slate-800">Half-sheet (A5) print orientation</p>
              <p className="text-xs text-slate-500 mt-0.5">
                Default orientation for A5/estimate invoice prints. Portrait matches the currently accepted print layout.
                The print preview still allows switching per print.
              </p>
            </div>
          </div>
          <select
            className="text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white text-slate-800 shrink-0"
            value={a5Orientation}
            disabled={saving}
            onChange={(e) =>
              save(
                { print: { ...settings.print, defaultOrientation: e.target.value as 'PORTRAIT' | 'LANDSCAPE' } },
                'A5 print orientation default saved.'
              )
            }
          >
            <option value="PORTRAIT">Portrait (current default)</option>
            <option value="LANDSCAPE">Landscape</option>
          </select>
        </div>
      </div>

      <button
        type="button"
        onClick={() => refreshSettings()}
        className="inline-flex items-center gap-2 text-xs text-slate-500 hover:text-slate-700"
      >
        <RefreshCw className="h-3.5 w-3.5" /> Reload settings from server
      </button>
    </div>
  );
};
