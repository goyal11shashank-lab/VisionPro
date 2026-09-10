/**
 * Reusable Export / Print Actions Menu / Toolbar
 * Provides quick actions: Print Preview, Direct Print, PDF, Excel (.xlsx), and CSV.
 */
import React, { useState } from 'react';
import {
  Printer,
  FileText,
  FileSpreadsheet,
  Download,
  Eye,
  ChevronDown,
  RefreshCw,
} from 'lucide-react';

export interface ExportActionsMenuProps {
  onPrintPreview: () => void;
  onPrintDirect?: () => void;
  onExportPdf?: () => void;
  onExportExcel?: () => void;
  onExportCsv?: () => void;
  isPdfLoading?: boolean;
  isExcelLoading?: boolean;
  isCsvLoading?: boolean;
  label?: string;
  size?: 'sm' | 'md';
  variant?: 'buttons' | 'dropdown';
}

export const ExportActionsMenu: React.FC<ExportActionsMenuProps> = ({
  onPrintPreview,
  onPrintDirect,
  onExportPdf,
  onExportExcel,
  onExportCsv,
  isPdfLoading = false,
  isExcelLoading = false,
  isCsvLoading = false,
  label = 'Print & Export',
  size = 'md',
  variant = 'buttons',
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const btnClass = size === 'sm'
    ? 'px-2.5 py-1 text-xs'
    : 'px-3.5 py-1.5 text-xs';

  if (variant === 'dropdown') {
    return (
      <div className="relative inline-block text-left no-print">
        <button
          type="button"
          onClick={() => setIsOpen(prev => !prev)}
          className={`flex items-center gap-1.5 font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded shadow-xs transition ${btnClass}`}
        >
          <Printer className="w-4 h-4 text-slate-600" />
          <span>{label}</span>
          <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
        </button>

        {isOpen && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setIsOpen(false)} />
            <div className="absolute right-0 mt-1 w-48 bg-white border border-slate-200 rounded-md shadow-lg py-1 z-30 divide-y divide-slate-100 font-sans text-xs">
              <div className="py-1">
                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    onPrintPreview();
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-slate-50 flex items-center gap-2 text-slate-700"
                >
                  <Eye className="w-4 h-4 text-blue-600" />
                  <span>Print Preview</span>
                </button>
                {onPrintDirect && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsOpen(false);
                      onPrintDirect();
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-slate-50 flex items-center gap-2 text-slate-700"
                  >
                    <Printer className="w-4 h-4 text-slate-600" />
                    <span>Quick Print</span>
                  </button>
                )}
              </div>

              <div className="py-1">
                {onExportPdf && (
                  <button
                    type="button"
                    disabled={isPdfLoading}
                    onClick={() => {
                      setIsOpen(false);
                      onExportPdf();
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-slate-50 flex items-center gap-2 text-slate-700 disabled:opacity-50"
                  >
                    {isPdfLoading ? <RefreshCw className="w-4 h-4 animate-spin text-red-600" /> : <FileText className="w-4 h-4 text-red-600" />}
                    <span>Export PDF (.pdf)</span>
                  </button>
                )}
                {onExportExcel && (
                  <button
                    type="button"
                    disabled={isExcelLoading}
                    onClick={() => {
                      setIsOpen(false);
                      onExportExcel();
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-slate-50 flex items-center gap-2 text-slate-700 disabled:opacity-50"
                  >
                    {isExcelLoading ? <RefreshCw className="w-4 h-4 animate-spin text-emerald-600" /> : <FileSpreadsheet className="w-4 h-4 text-emerald-600" />}
                    <span>Export Excel (.xlsx)</span>
                  </button>
                )}
                {onExportCsv && (
                  <button
                    type="button"
                    disabled={isCsvLoading}
                    onClick={() => {
                      setIsOpen(false);
                      onExportCsv();
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-slate-50 flex items-center gap-2 text-slate-700 disabled:opacity-50"
                  >
                    {isCsvLoading ? <RefreshCw className="w-4 h-4 animate-spin text-slate-600" /> : <Download className="w-4 h-4 text-slate-600" />}
                    <span>Export CSV (.csv)</span>
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  // Button Group variant
  return (
    <div className="flex items-center gap-1.5 no-print">
      <button
        type="button"
        onClick={onPrintPreview}
        className={`flex items-center gap-1 font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded shadow-2xs transition ${btnClass}`}
        title="Open Print Preview"
      >
        <Eye className="w-3.5 h-3.5 text-blue-600" />
        <span>Preview</span>
      </button>

      {onPrintDirect && (
        <button
          type="button"
          onClick={onPrintDirect}
          className={`flex items-center gap-1 font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded shadow-2xs transition ${btnClass}`}
          title="Print Voucher / Report"
        >
          <Printer className="w-3.5 h-3.5 text-slate-600" />
          <span>Print</span>
        </button>
      )}

      {onExportPdf && (
        <button
          type="button"
          disabled={isPdfLoading}
          onClick={onExportPdf}
          className={`flex items-center gap-1 font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded shadow-2xs transition disabled:opacity-50 ${btnClass}`}
          title="Export as PDF"
        >
          {isPdfLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
          <span>PDF</span>
        </button>
      )}

      {onExportExcel && (
        <button
          type="button"
          disabled={isExcelLoading}
          onClick={onExportExcel}
          className={`flex items-center gap-1 font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded shadow-2xs transition disabled:opacity-50 ${btnClass}`}
          title="Export as Excel (.xlsx)"
        >
          {isExcelLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <FileSpreadsheet className="w-3.5 h-3.5" />}
          <span>Excel</span>
        </button>
      )}

      {onExportCsv && (
        <button
          type="button"
          disabled={isCsvLoading}
          onClick={onExportCsv}
          className={`flex items-center gap-1 font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded shadow-2xs transition disabled:opacity-50 ${btnClass}`}
          title="Export as CSV (.csv)"
        >
          {isCsvLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          <span>CSV</span>
        </button>
      )}
    </div>
  );
};
