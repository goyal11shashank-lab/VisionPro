import React, { useState, useEffect } from 'react';
import { ArrowLeft, Printer, FileText, RefreshCw } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { useBusinessSettings } from '../../context/BusinessSettingsContext.js';
import { PrintableVoucher } from '../../components/print/PrintableVoucher.js';
import { exportToPdf } from '../../utils/pdfExporter.js';
import { printDocument } from '../../utils/printService.js';
import { getStoredToken } from '../../api/client.js';
import { usesOpticalPrintBrand } from '../../utils/printBranding.js';

interface Props {
  invoiceId: string;
  onBack?: () => void;
  autoPrint?: boolean;
}

export const SalesInvoicePrintPage: React.FC<Props> = ({ invoiceId, onBack, autoPrint = false }) => {
  const { currentBusiness } = useAuth();
  const { settings } = useBusinessSettings();
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const halfSheet = usesOpticalPrintBrand(currentBusiness);
  const [invoice, setInvoice] = useState<any | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isExportingPdf, setIsExportingPdf] = useState<boolean>(false);
  const [isPrinting, setIsPrinting] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;

    async function fetchInvoice() {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch(`/api/sales/invoices/${invoiceId}`, {
          headers: {
            Authorization: `Bearer ${getStoredToken()}`,
            'X-Business-Id': currentBusiness?.id || '',
          },
        });

        if (!res.ok) {
          throw new Error(`Failed to load invoice (${res.status} ${res.statusText})`);
        }

        const data = await res.json();
        if (isMounted) {
          setInvoice(data);
          setLoading(false);


        }
      } catch (err: any) {
        if (isMounted) {
          console.error('Error loading printable invoice:', err);
          setError(err.message || 'Failed to load sales invoice.');
          setLoading(false);
        }
      }
    }

    if (invoiceId) {
      fetchInvoice();
    }

    return () => {
      isMounted = false;
    };
  }, [invoiceId, currentBusiness?.id, autoPrint]);

  const handlePrint = async () => {
    if (isPrinting || !invoice) return;
    setIsPrinting(true);
    try {
      await printDocument({
        elementOrId: 'printable-sales-invoice-root',
        title: `Invoice - ${invoice.invoiceNumber || invoiceId}`,
        filename: `Invoice_${invoice.invoiceNumber || invoiceId}`,
        orientation,
      });
    } catch (err: any) {
      console.error('Print failed:', err);
      // Fallback
      window.print();
    } finally {
      setIsPrinting(false);
    }
  };

  useEffect(() => {
    if (autoPrint && invoice && !loading) void handlePrint();
  }, [autoPrint, invoice, loading]);

  const handleExportPdf = async () => {
    if (isExportingPdf || !invoice) return;
    setIsExportingPdf(true);
    try {
      await exportToPdf({
        elementOrId: 'printable-sales-invoice-root',
        filename: `Invoice_${invoice.invoiceNumber || invoiceId}`,
        orientation,
      });
    } catch (err: any) {
      console.error('PDF export failed:', err);
    } finally {
      setIsExportingPdf(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
        <div className="flex items-center gap-3 bg-white px-5 py-3 rounded-lg shadow-sm border border-slate-200">
          <RefreshCw className="w-5 h-5 text-blue-600 animate-spin" />
          <span className="text-sm font-medium text-slate-700">Loading printable invoice...</span>
        </div>
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
        <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200 max-w-md w-full text-center space-y-4">
          <div className="text-red-500 font-bold text-base">Unable to Load Invoice</div>
          <p className="text-xs text-slate-600">{error || 'Invoice not found.'}</p>
          <button
            onClick={onBack || (() => window.history.back())}
            className="px-4 py-2 bg-slate-800 text-white rounded text-xs font-semibold hover:bg-slate-700 transition"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-200 text-slate-900 flex flex-col">
      {/* Top Floating Action Bar (Hidden on System Print) */}
      <header className="no-print sticky top-0 z-30 bg-slate-900 text-white px-4 py-3 shadow-md flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            id="btn-print-page-back"
            onClick={onBack || (() => window.history.back())}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-xs font-semibold transition"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </button>
          <div>
            <h1 className="text-sm font-bold leading-tight">
              Invoice print {invoice.invoiceNumber ? `(${invoice.invoiceNumber})` : ''}
            </h1>
            <p className="text-[11px] text-slate-400">
              Ready for Browser / System Print dialog
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {halfSheet && <select aria-label="Half-sheet orientation" value={orientation} onChange={e => setOrientation(e.target.value as 'portrait' | 'landscape')} className="bg-slate-800 text-white px-2 py-1 rounded text-xs">
            <option value="portrait">A5 Portrait</option><option value="landscape">A5 Landscape</option>
          </select>}
          <button
            id="btn-print-page-pdf"
            onClick={handleExportPdf}
            disabled={isExportingPdf}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-500 disabled:bg-red-800 text-white rounded text-xs font-semibold transition shadow-xs"
          >
            {isExportingPdf ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <FileText className="w-3.5 h-3.5" />
            )}
            <span>Export PDF</span>
          </button>

          <button
            id="btn-print-page-invoke"
            onClick={handlePrint}
            disabled={isPrinting}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-white rounded text-xs font-bold transition shadow-sm"
          >
            {isPrinting ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Printer className="w-4 h-4" />
            )}
            <span>Print Invoice</span>
          </button>
        </div>
      </header>

      {halfSheet && <div className="no-print bg-slate-100 text-slate-700 px-4 py-2 text-xs">Half-A4 / A5 sheets, with safe margins. Choose the matching orientation. Physical feed direction and clipping still need one printer test.</div>}
      {/* Main Printable Presentation Container */}
      <main className="flex-1 p-4 md:p-8 flex justify-center items-start overflow-auto">
        <div className="print-content-wrapper">
          <PrintableVoucher
            id="printable-sales-invoice-root"
            orientation={orientation}
            business={currentBusiness}
            voucher={invoice}
            documentType="SALES_INVOICE"
            customTitle={settings?.print?.invoiceTitle || 'TAX INVOICE'}
            copyLabel="Original for Recipient"
          />
        </div>
      </main>
    </div>
  );
};
