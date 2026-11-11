import React, { useState, useRef } from 'react';
import {
  FileSpreadsheet,
  UploadCloud,
  CheckCircle2,
  AlertTriangle,
  X,
  ChevronDown,
  ChevronRight,
  Download,
  AlertCircle,
  RefreshCw,
  Layers,
  ArrowRight,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { apiRequest } from '../../api/client';
import { VoucherLineItem } from '../voucher/VoucherTypes';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onImport: (importedLines: VoucherLineItem[]) => void;
}

interface RawExcelRow {
  rowNumber: number;
  stockItem: string;
  sph: string | number;
  cyl: string | number;
  axis: string | number;
  addition: string | number;
  side: string;
  quantity: string | number;
}

export const PurchaseExcelImportModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onImport,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [parsing, setParsing] = useState<boolean>(false);
  const [parseError, setParseError] = useState<string | null>(null);

  // Validation response from backend
  const [validationResult, setValidationResult] = useState<{
    success: boolean;
    summary: {
      totalRows: number;
      validRows: number;
      errorRows: number;
      stockItemsCount: number;
      batchesCount: number;
    };
    errors: Array<{
      rowNumber: number;
      stockItem: string;
      sph?: number;
      cyl?: number;
      axis?: number;
      addition?: number;
      side?: string;
      quantity?: number;
      reason: string;
      isMissingBatch?: boolean;
    }>;
    groupedLines: VoucherLineItem[];
  } | null>(null);

  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const toggleExpand = (id: string) => {
    setExpandedItems(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // 1. Download Sample Excel Template
  const handleDownloadTemplate = () => {
    const headers = [
      'stock item',
      'sph',
      'cyl',
      'axis',
      'addition',
      'side',
      'quantity',
    ];

    const sampleRows = [
      {
        'stock item': 'SV 1.56 AR - Standard',
        sph: '-2.00',
        cyl: '0.00',
        axis: '0',
        addition: '0.00',
        side: 'NONE',
        quantity: 10,
      },
      {
        'stock item': 'SV 1.56 AR - Standard',
        sph: '-2.50',
        cyl: '-0.50',
        axis: '90',
        addition: '0.00',
        side: 'NONE',
        quantity: 5,
      },
      {
        'stock item': 'Blue Cut 1.60 HC',
        sph: '+1.50',
        cyl: '0.00',
        axis: '0',
        addition: '0.00',
        side: 'NONE',
        quantity: 8,
      },
      {
        'stock item': 'SV 1.56 AR - Standard',
        sph: '-2.00',
        cyl: '0.00',
        axis: '0',
        addition: '0.00',
        side: 'NONE',
        quantity: 5,
      },
      {
        'stock item': 'Progressive Poly 1.59',
        sph: '+1.00',
        cyl: '-0.50',
        axis: '180',
        addition: '+2.00',
        side: 'R',
        quantity: 2,
      },
      {
        'stock item': 'Progressive Poly 1.59',
        sph: '+1.00',
        cyl: '-0.50',
        axis: '180',
        addition: '+2.00',
        side: 'L',
        quantity: 2,
      },
    ];

    const ws = XLSX.utils.json_to_sheet(sampleRows, { header: headers });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Purchase Import');
    XLSX.writeFile(wb, 'purchase_voucher_import_template.xlsx');
  };

  // 2. Parse Excel File
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setFileName(selectedFile.name);
    setParseError(null);
    setValidationResult(null);
    setParsing(true);

    try {
      const buffer = await selectedFile.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) {
        throw new Error('Spreadsheet does not contain any sheets.');
      }

      const worksheet = workbook.Sheets[firstSheetName];
      const rawRows: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

      if (!rawRows || rawRows.length === 0) {
        throw new Error('Spreadsheet contains no data rows.');
      }

      // Map columns flexibly
      const normalizedRows: RawExcelRow[] = rawRows.map((r, idx) => {
        const rowNumber = idx + 2; // header is row 1
        const keys = Object.keys(r);

        const findVal = (possibleNames: string[]) => {
          for (const k of keys) {
            const cleanKey = k.toLowerCase().replace(/[^a-z0-9]/g, '');
            for (const name of possibleNames) {
              const cleanName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
              if (cleanKey === cleanName) {
                return r[k];
              }
            }
          }
          return '';
        };

        const stockItem = String(findVal(['stock item', 'stockitem', 'stock_item', 'item', 'item name', 'product']) || '').trim();
        const sph = findVal(['sph', 'sphere', 'power']);
        const cyl = findVal(['cyl', 'cylinder']);
        const axis = findVal(['axis', 'ax']);
        const addition = findVal(['addition', 'add']);
        const side = findVal(['side', 'eye']);
        const quantity = findVal(['quantity', 'qty', 'count', 'pcs', 'prs']);

        return {
          rowNumber,
          stockItem,
          sph,
          cyl,
          axis,
          addition,
          side: String(side || 'NONE'),
          quantity,
        };
      });

      // Send to server-side validation endpoint
      const result = await apiRequest<any>('/api/purchases/validate-excel-import', {
        method: 'POST',
        body: JSON.stringify({ rows: normalizedRows }),
      });

      setValidationResult(result);
    } catch (err: any) {
      console.error('Failed to parse Excel file:', err);
      setParseError(err.message || 'Failed to read spreadsheet. Please ensure it is a valid .xlsx, .xls, or .csv file.');
    } finally {
      setParsing(false);
    }
  };

  // 3. Confirm Import into Purchase Voucher
  const handleConfirmImport = (onlyValid: boolean = false) => {
    if (!validationResult || !validationResult.groupedLines || validationResult.groupedLines.length === 0) {
      return;
    }

    if (!onlyValid && validationResult.errors.length > 0) {
      // Must not silently ignore errors unless user chooses "Import Valid Only"
      return;
    }

    onImport(validationResult.groupedLines);
    onClose();
  };

  const handleResetFile = () => {
    setFile(null);
    setFileName('');
    setValidationResult(null);
    setParseError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div
      id="modal-purchase-excel-import"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-xs animate-in fade-in"
    >
      <div className="bg-white rounded-xl max-w-4xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-300 overflow-hidden font-sans">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-slate-900 text-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-lg border border-emerald-500/30">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-tight">
                Import Purchase Voucher from Excel
              </h2>
              <p className="text-xs text-slate-300">
                Auto-groups optical batches under stock items • Strict zero-creation master batch validation
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
            title="Close Modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Top Info Banner & Template Download */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-950 text-xs">
            <div className="flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-emerald-900">
                  Required Columns: <code className="bg-emerald-100/80 px-1 py-0.5 rounded text-emerald-900 font-mono">stock item, sph, cyl, axis, addition, side, quantity</code>
                </p>
                <p className="text-emerald-800 mt-0.5">
                  Batches for the same stock item are consolidated into a single voucher row, even if rows are scattered.
                </p>
              </div>
            </div>
            <button
              type="button"
              id="btn-download-import-template"
              onClick={handleDownloadTemplate}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-emerald-800 hover:bg-emerald-100 font-bold border border-emerald-300 rounded shadow-2xs transition-colors shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download Excel Template</span>
            </button>
          </div>

          {/* Upload Dropzone */}
          {!file ? (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-300 hover:border-emerald-500 hover:bg-emerald-50/30 rounded-xl p-8 flex flex-col items-center justify-center gap-3 cursor-pointer transition-all text-center group"
            >
              <div className="p-3 bg-slate-100 group-hover:bg-emerald-100 text-slate-600 group-hover:text-emerald-700 rounded-full transition-colors">
                <UploadCloud className="w-7 h-7" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-800 group-hover:text-emerald-900">
                  Click to browse or drag & drop your Excel file here
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Supports Microsoft Excel (.xlsx, .xls) and CSV (.csv) up to 25MB
                </p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileChange}
                className="hidden"
              />
            </div>
          ) : (
            <div className="flex items-center justify-between p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2 bg-emerald-100 text-emerald-700 rounded-md">
                  <FileSpreadsheet className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-900 truncate">{fileName}</p>
                  <p className="text-xs text-slate-500 font-mono">
                    {(file.size / 1024).toFixed(1)} KB • {parsing ? 'Validating against optical master...' : 'File parsed'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleResetFile}
                className="px-2.5 py-1 text-xs font-semibold text-slate-600 hover:text-rose-700 hover:bg-rose-50 border border-slate-300 rounded cursor-pointer transition-colors"
              >
                Change File
              </button>
            </div>
          )}

          {/* Parsing Spinner */}
          {parsing && (
            <div className="flex flex-col items-center justify-center p-8 space-y-3 text-slate-600">
              <RefreshCw className="w-7 h-7 animate-spin text-emerald-600" />
              <p className="text-sm font-medium">
                Validating optical batches and grouping stock items...
              </p>
            </div>
          )}

          {/* Parse / File Error */}
          {parseError && (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-3 text-rose-900 text-xs">
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-bold text-rose-950">Spreadsheet Parsing Error</p>
                <p>{parseError}</p>
              </div>
            </div>
          )}

          {/* Validation Result View */}
          {validationResult && (
            <div className="space-y-4">
              {/* Metrics Bar */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                    Total Rows
                  </span>
                  <span className="text-lg font-black text-slate-800 font-mono">
                    {validationResult.summary.totalRows}
                  </span>
                </div>
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                  <span className="text-[11px] font-bold text-emerald-800 uppercase tracking-wider block">
                    Grouped Items
                  </span>
                  <span className="text-lg font-black text-emerald-900 font-mono">
                    {validationResult.summary.stockItemsCount}
                  </span>
                </div>
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <span className="text-[11px] font-bold text-blue-800 uppercase tracking-wider block">
                    Allocated Batches
                  </span>
                  <span className="text-lg font-black text-blue-900 font-mono">
                    {validationResult.summary.batchesCount}
                  </span>
                </div>
                <div
                  className={`p-3 rounded-lg border ${
                    validationResult.summary.errorRows > 0
                      ? 'bg-rose-50 border-rose-200 text-rose-900'
                      : 'bg-slate-50 border-slate-200 text-slate-400'
                  }`}
                >
                  <span className="text-[11px] font-bold uppercase tracking-wider block">
                    Errors / Warnings
                  </span>
                  <span
                    className={`text-lg font-black font-mono ${
                      validationResult.summary.errorRows > 0 ? 'text-rose-700' : 'text-slate-600'
                    }`}
                  >
                    {validationResult.summary.errorRows}
                  </span>
                </div>
              </div>

              {/* Error / Missing Batch Alert Box */}
              {validationResult.errors.length > 0 && (
                <div
                  id="purchase-import-errors-container"
                  className="bg-rose-50 border-2 border-rose-300 rounded-xl p-4 text-xs text-rose-950 space-y-3"
                >
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="font-black text-rose-900 text-sm">
                        Validation Warning: {validationResult.errors.length} batch(es) / item(s) could not be resolved
                      </h4>
                      <p className="text-rose-800 mt-0.5">
                        <strong>Rule Enforced:</strong> New batches cannot be created during purchase voucher upload. Batches must already exist in Master Catalog.
                      </p>
                    </div>
                  </div>

                  <div className="max-h-56 overflow-y-auto border border-rose-200 rounded-lg bg-white shadow-2xs divide-y divide-rose-100">
                    {validationResult.errors.map((err, i) => (
                      <div key={i} className="p-2.5 flex items-start justify-between gap-3 text-xs">
                        <div className="space-y-0.5 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="px-1.5 py-0.5 bg-rose-100 text-rose-800 font-mono font-bold rounded text-[11px]">
                              Row {err.rowNumber}
                            </span>
                            <span className="font-bold text-slate-900 truncate">
                              {err.stockItem || 'Unknown Item'}
                            </span>
                            {err.quantity !== undefined && (
                              <span className="text-slate-500 font-mono text-[11px]">
                                (Qty: {err.quantity})
                              </span>
                            )}
                          </div>
                          <p className="text-rose-700 font-medium">{err.reason}</p>
                        </div>
                        <span className="px-2 py-0.5 bg-rose-100 text-rose-800 rounded font-bold text-[10px] shrink-0 uppercase tracking-tight">
                          {err.isMissingBatch ? 'Missing Batch' : 'Item Error'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Grouped Stock Items Preview */}
              {validationResult.groupedLines.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Layers className="w-4 h-4 text-emerald-700" />
                      <h4 className="font-bold text-slate-800 text-xs uppercase tracking-tight">
                        Grouped Purchase Lines Ready to Import ({validationResult.groupedLines.length} Items)
                      </h4>
                    </div>
                    <span className="text-[11px] text-slate-500">
                      Click item to preview batch power coordinates
                    </span>
                  </div>

                  <div className="border border-slate-300 rounded-xl overflow-hidden divide-y divide-slate-200 shadow-2xs">
                    {validationResult.groupedLines.map(line => {
                      const isExpanded = Boolean(expandedItems[line.uniqueItemId]);
                      return (
                        <div key={line.uniqueItemId} className="bg-white">
                          <div
                            onClick={() => toggleExpand(line.uniqueItemId)}
                            className="p-3 flex items-center justify-between cursor-pointer hover:bg-slate-50 transition-colors select-none"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <button
                                type="button"
                                className="text-slate-400 hover:text-slate-600"
                              >
                                {isExpanded ? (
                                  <ChevronDown className="w-4 h-4" />
                                ) : (
                                  <ChevronRight className="w-4 h-4" />
                                )}
                              </button>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-slate-900 text-xs truncate">
                                    {line.uniqueItemName}
                                  </span>
                                  {line.uniqueItemCode && (
                                    <span className="text-[11px] font-mono text-slate-500 bg-slate-100 px-1 rounded">
                                      {line.uniqueItemCode}
                                    </span>
                                  )}
                                  <span className="px-1.5 py-0.2 bg-blue-50 text-blue-700 border border-blue-200 rounded font-mono text-[10px] font-bold">
                                    {line.categoryCode}
                                  </span>
                                </div>
                                <p className="text-[11px] text-slate-500 mt-0.5">
                                  {line.batches.length} batch allocation(s) consolidated • Rate: ₹{line.rate.toFixed(2)}
                                </p>
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <span className="font-black text-slate-900 text-sm font-mono block">
                                Total: {line.quantity} {line.unit}
                              </span>
                              <span className="text-[11px] text-emerald-700 font-bold">
                                ₹{(line.quantity * line.rate).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                              </span>
                            </div>
                          </div>

                          {/* Expandable Batches Table */}
                          {isExpanded && (
                            <div className="bg-slate-50/80 p-3 border-t border-slate-200">
                              <table className="w-full text-xs font-mono text-left">
                                <thead>
                                  <tr className="text-[10px] uppercase font-bold text-slate-500 border-b border-slate-200">
                                    <th className="py-1 px-2">SPH</th>
                                    <th className="py-1 px-2">CYL</th>
                                    <th className="py-1 px-2">AXIS</th>
                                    <th className="py-1 px-2">ADD</th>
                                    <th className="py-1 px-2">SIDE</th>
                                    <th className="py-1 px-2 text-right">Quantity</th>
                                    <th className="py-1 px-2">Barcode</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 text-slate-800">
                                  {line.batches.map((b, bIdx) => (
                                    <tr key={bIdx} className="hover:bg-slate-100/60">
                                      <td className="py-1 px-2 font-bold">
                                        {Number(b.sph) > 0 ? `+${Number(b.sph).toFixed(2)}` : Number(b.sph).toFixed(2)}
                                      </td>
                                      <td className="py-1 px-2">
                                        {Number(b.cyl) > 0 ? `+${Number(b.cyl).toFixed(2)}` : Number(b.cyl).toFixed(2)}
                                      </td>
                                      <td className="py-1 px-2">{Number(b.axis) > 0 ? `${b.axis}°` : '-'}</td>
                                      <td className="py-1 px-2">{Number(b.add) > 0 ? `+${Number(b.add).toFixed(2)}` : '-'}</td>
                                      <td className="py-1 px-2 font-bold">{b.side || 'NONE'}</td>
                                      <td className="py-1 px-2 font-black text-right text-emerald-800">
                                        {b.quantity}
                                      </td>
                                      <td className="py-1 px-2 text-[10px] text-slate-500 truncate max-w-[120px]">
                                        {b.barcode || '-'}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Action Buttons */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-slate-50 border-t border-slate-200 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg cursor-pointer transition-colors"
          >
            Cancel
          </button>

          <div className="flex items-center gap-2">
            {validationResult && validationResult.errors.length > 0 && validationResult.groupedLines.length > 0 && (
              <button
                type="button"
                id="btn-confirm-import-valid-only"
                onClick={() => handleConfirmImport(true)}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-lg cursor-pointer transition-colors shadow-2xs"
              >
                <span>Import Valid Lines Only ({validationResult.groupedLines.length} Items)</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}

            {validationResult && validationResult.groupedLines.length > 0 && (
              <button
                type="button"
                id="btn-confirm-import-all"
                disabled={validationResult.errors.length > 0}
                onClick={() => handleConfirmImport(false)}
                className={`flex items-center gap-1.5 px-5 py-2 text-xs font-black rounded-lg shadow-xs cursor-pointer transition-colors ${
                  validationResult.errors.length === 0
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                    : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                }`}
                title={
                  validationResult.errors.length > 0
                    ? 'Cannot import all because there are missing batches or items. Fix spreadsheet or click "Import Valid Lines Only".'
                    : 'Import validated grouped batches into purchase voucher'
                }
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Upload Data into Voucher</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
