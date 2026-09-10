/**
 * Professional Print Preview Dialog / Modal
 * Displays realistic A4 printable document preview with dedicated print toolbar:
 * Print (window.print), Export PDF, Export Excel, Export CSV, and page orientation toggle.
 */
import React, { useState } from 'react';
import {
  Printer,
  FileText,
  FileSpreadsheet,
  Download,
  X,
  RefreshCw,
  Maximize2,
  ZoomIn,
  ZoomOut,
  LayoutTemplate,
} from 'lucide-react';
import { exportToPdf } from '../../utils/pdfExporter.js';
import { printDocument } from '../../utils/printService.js';

export interface PrintPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  filename: string;
  defaultOrientation?: 'portrait' | 'landscape';
  onExportExcel?: () => void;
  onExportCsv?: () => void;
  autoInvokePrint?: boolean;
  children: (props: { orientation: 'portrait' | 'landscape'; documentId: string }) => React.ReactNode;
}

export const PrintPreviewModal: React.FC<PrintPreviewModalProps> = ({
  isOpen,
  onClose,
  title,
  filename,
  defaultOrientation = 'portrait',
  onExportExcel,
  onExportCsv,
  autoInvokePrint = false,
  children,
}) => {
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>(defaultOrientation);
  const [zoom, setZoom] = useState<number>(100);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const documentId = 'printable-document-content';

  const handlePrint = async () => {
    if (isPrinting) return;
    setIsPrinting(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const result = await printDocument({
        elementOrId: documentId,
        title,
        filename,
        orientation,
      });

      // Only display message if it gracefully fell back to PDF download
      if (result.method === 'pdf_download' && result.message) {
        setStatusMessage(result.message);
      }
    } catch (err: any) {
      console.error('Print error:', err);
      setErrorMessage(err.message || 'Unable to open system print dialog.');
    } finally {
      setIsPrinting(false);
    }
  };

  // Auto-invoke native print if requested (e.g. previewBeforePrint = false)
  React.useEffect(() => {
    if (isOpen && autoInvokePrint) {
      const timer = setTimeout(() => {
        handlePrint();
      }, 250);
      return () => clearTimeout(timer);
    }
  }, [isOpen, autoInvokePrint]);

  if (!isOpen) return null;

  const handleExportPdf = async () => {
    if (isExportingPdf) return;
    setIsExportingPdf(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      await exportToPdf({
        elementOrId: documentId,
        filename,
        orientation,
      });
      setStatusMessage('PDF document generated and downloaded successfully.');
    } catch (err: any) {
      console.error('PDF Export error:', err);
      setErrorMessage(err.message || 'Unable to export PDF.');
    } finally {
      setIsExportingPdf(false);
    }
  };

  return (
    <div
      id="print-preview-modal-root"
      className="print-preview-dialog fixed inset-0 z-50 flex flex-col bg-slate-900/80 backdrop-blur-xs overflow-hidden"
    >
      {/* Top Floating Print Toolbar (Hidden on System Print) */}
      <div className="print-toolbar no-print bg-slate-900 text-white px-4 py-2.5 flex items-center justify-between border-b border-slate-700 shadow-md">
        {/* Left: Title & Orientation */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <LayoutTemplate className="w-4 h-4 text-emerald-400" />
            <span className="font-bold text-sm tracking-tight">{title}</span>
          </div>
          <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
            A4 {orientation === 'portrait' ? 'Portrait' : 'Landscape'}
          </span>
          <button
            onClick={() => setOrientation(prev => (prev === 'portrait' ? 'landscape' : 'portrait'))}
            className="text-xs px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 transition font-medium border border-slate-700"
            title="Toggle between Portrait and Landscape"
          >
            Switch to {orientation === 'portrait' ? 'Landscape' : 'Portrait'}
          </button>
        </div>

        {/* Center: Zoom Controls */}
        <div className="hidden md:flex items-center gap-1.5 bg-slate-800 px-2 py-1 rounded border border-slate-700 text-xs">
          <button
            onClick={() => setZoom(z => Math.max(50, z - 10))}
            className="p-1 hover:text-emerald-400 text-slate-300"
            title="Zoom Out"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="font-mono w-10 text-center">{zoom}%</span>
          <button
            onClick={() => setZoom(z => Math.min(150, z + 10))}
            className="p-1 hover:text-emerald-400 text-slate-300"
            title="Zoom In"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setZoom(100)}
            className="p-1 hover:text-emerald-400 text-slate-300 text-[10px] uppercase font-bold"
            title="Reset Zoom"
          >
            100%
          </button>
        </div>

        {/* Right: Export & Print Action Buttons */}
        <div className="flex items-center gap-2">
          {/* Excel Export (If available) */}
          {onExportExcel && (
            <button
              onClick={onExportExcel}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded text-xs font-semibold shadow-xs transition"
              title="Download Excel Workbook (.xlsx)"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Excel</span>
            </button>
          )}

          {/* CSV Export (If available) */}
          {onExportCsv && (
            <button
              onClick={onExportCsv}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded text-xs font-semibold transition"
              title="Download CSV file (.csv)"
            >
              <Download className="w-3.5 h-3.5" />
              <span>CSV</span>
            </button>
          )}

          {/* PDF Export */}
          <button
            onClick={handleExportPdf}
            disabled={isExportingPdf}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-500 disabled:bg-red-800 text-white rounded text-xs font-semibold shadow-xs transition"
            title="Download PDF document"
          >
            {isExportingPdf ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Preparing PDF...</span>
              </>
            ) : (
              <>
                <FileText className="w-3.5 h-3.5" />
                <span>PDF</span>
              </>
            )}
          </button>

          {/* Actual System Print */}
          <button
            id="btn-modal-system-print"
            onClick={handlePrint}
            disabled={isPrinting}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-white rounded text-xs font-bold shadow-sm transition"
            title="Open System Print Dialog"
          >
            {isPrinting ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Printing...</span>
              </>
            ) : (
              <>
                <Printer className="w-4 h-4" />
                <span>Print</span>
              </>
            )}
          </button>

          {/* Close Modal Button */}
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition ml-2"
            title="Close Preview"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Informational / Status banner */}
      {statusMessage && (
        <div className="no-print bg-emerald-600 text-white px-4 py-2 text-xs font-medium flex justify-between items-center shadow-xs">
          <span>{statusMessage}</span>
          <button onClick={() => setStatusMessage(null)} className="font-bold ml-2 hover:opacity-80">✕</button>
        </div>
      )}

      {/* Error banner if export failed */}
      {errorMessage && (
        <div className="no-print bg-red-600 text-white px-4 py-2 text-xs font-medium flex justify-between items-center">
          <span>{errorMessage}</span>
          <button onClick={() => setErrorMessage(null)} className="font-bold ml-2">✕</button>
        </div>
      )}

      {/* Main Preview Canvas Area */}
      <div className="flex-1 overflow-auto p-4 md:p-8 bg-slate-800/90 flex justify-center items-start">
        <div
          style={{
            transform: `scale(${zoom / 100})`,
            transformOrigin: 'top center',
            transition: 'transform 0.15s ease',
          }}
          className="print-content-wrapper"
        >
          {children({ orientation, documentId })}
        </div>
      </div>
    </div>
  );
};
