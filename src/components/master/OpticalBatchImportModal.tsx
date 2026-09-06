import React, { useState, useRef } from 'react';
import {
  Upload,
  FileSpreadsheet,
  Download,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowRight,
  RefreshCw,
  X,
  FileText,
  HelpCircle,
  Layers,
  Sparkles,
  Barcode as BarcodeIcon,
} from 'lucide-react';
import { apiRequest, getStoredToken } from '../../api/client.js';
import { generateClientOpticalBatchTemplate } from '../../utils/excelTemplateGenerator.js';

interface OpticalBatchImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface ValidationResult {
  sessionId: string;
  fileName: string;
  importType: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  preview: {
    rows: Array<{
      rowNumber: number;
      isValid: boolean;
      isDuplicate: boolean;
      raw: Record<string, any>;
      mapped: Record<string, any>;
      resolvedData?: {
        uniqueItem?: { id: string; name: string; code: string };
        powers?: {
          sphNum: number;
          cylNum: number;
          axisNum: number;
          addNum: number;
          sideNormalized: string;
          identityKey: string;
        };
        sku?: string;
        openingStockQuantity?: number;
        purchaseCost?: number;
        sellingPrice?: number;
        unit?: string;
        barcode?: string;
        supplierParty?: { id: string; name: string };
      };
      errors: Array<{
        row: number;
        field: string;
        value: any;
        severity: 'ERROR' | 'WARNING';
        message: string;
      }>;
    }>;
    errorSummary: Array<{
      row: number;
      field: string;
      value: any;
      severity: 'ERROR' | 'WARNING';
      message: string;
    }>;
    canPost: boolean;
  };
}

interface PostingResult {
  sessionId: string;
  status: 'COMPLETED' | 'COMPLETED_WITH_ERRORS' | 'FAILED';
  totalRows: number;
  postedRows: number;
  failedRows: number;
  postedDocuments: Array<{ id: string; type: string; documentNumber?: string; summary?: string }>;
  errors: Array<{ row?: number; message: string }>;
}

export const OpticalBatchImportModal: React.FC<OpticalBatchImportModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [step, setStep] = useState<'upload' | 'preview' | 'result'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [validationData, setValidationData] = useState<ValidationResult | null>(null);
  const [postingResult, setPostingResult] = useState<PostingResult | null>(null);
  const [previewFilter, setPreviewFilter] = useState<'all' | 'valid' | 'errors' | 'duplicates'>('all');
  const [downloadingErrors, setDownloadingErrors] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleDownloadTemplate = () => {
    try {
      setError(null);
      generateClientOpticalBatchTemplate();
    } catch (err: any) {
      setError(err.message || 'Error generating sample template.');
    }
  };

  const handleDownloadErrorReport = async (sessionId: string) => {
    try {
      setDownloadingErrors(true);
      const token = getStoredToken();
      const response = await fetch(`/api/imports/${sessionId}/errors/xlsx`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

      if (!response.ok) {
        throw new Error('Failed to download error report.');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Error_Report_Optical_Batches_${sessionId.slice(0, 8)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      alert(err.message || 'Could not download error report');
    } finally {
      setDownloadingErrors(false);
    }
  };

  const handleFileSelect = (selectedFile: File) => {
    if (!selectedFile.name.match(/\.(xlsx|xls|csv)$/i)) {
      setError('Please select an Excel (.xlsx, .xls) or CSV file.');
      return;
    }
    setFile(selectedFile);
    setError(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  const handleUploadAndValidate = async () => {
    if (!file) {
      setError('Please select a file to upload.');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const formData = new FormData();
      formData.append('file', file);
      formData.append('importType', 'OPTICAL_BATCH');

      const token = getStoredToken();
      const response = await fetch('/api/imports/upload', {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to process and validate Excel file.');
      }

      setValidationData(data);
      setStep('preview');
    } catch (err: any) {
      setError(err.message || 'Error processing file.');
    } finally {
      setLoading(false);
    }
  };

  const handlePostImport = async () => {
    if (!validationData?.sessionId) return;

    try {
      setLoading(true);
      setError(null);

      const res = await apiRequest<PostingResult>(`/api/imports/${validationData.sessionId}/post`, {
        method: 'POST',
      });

      setPostingResult(res);
      setStep('result');
      onSuccess(); // Refresh parent table in background
    } catch (err: any) {
      setError(err.message || 'Failed to execute import.');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setStep('upload');
    setFile(null);
    setError(null);
    setValidationData(null);
    setPostingResult(null);
    setPreviewFilter('all');
  };

  const rows = validationData?.preview?.rows || [];
  const filteredRows = rows.filter((r) => {
    if (previewFilter === 'valid') return r.isValid && !r.isDuplicate;
    if (previewFilter === 'errors') return !r.isValid;
    if (previewFilter === 'duplicates') return r.isDuplicate;
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50/70">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-indigo-100 flex items-center justify-center text-indigo-600">
              <FileSpreadsheet className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                Bulk Excel Import — Optical Batches & Stock
              </h2>
              <p className="text-xs text-slate-500">
                Upload batch quantities, optical power combinations, and initial stock registry.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-2 rounded-lg hover:bg-slate-200/50 cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Stepper Bar */}
        <div className="px-6 py-3 bg-white border-b border-slate-100 flex items-center justify-between text-xs font-medium">
          <div className="flex items-center gap-2">
            <span
              className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold ${
                step === 'upload'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-emerald-100 text-emerald-700'
              }`}
            >
              1
            </span>
            <span className={step === 'upload' ? 'text-indigo-600 font-bold' : 'text-slate-600'}>
              Upload & Download Sample
            </span>
          </div>

          <div className="h-px bg-slate-200 flex-1 mx-4" />

          <div className="flex items-center gap-2">
            <span
              className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold ${
                step === 'preview'
                  ? 'bg-indigo-600 text-white'
                  : step === 'result'
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-slate-100 text-slate-400'
              }`}
            >
              2
            </span>
            <span className={step === 'preview' ? 'text-indigo-600 font-bold' : 'text-slate-500'}>
              Validate & Preview
            </span>
          </div>

          <div className="h-px bg-slate-200 flex-1 mx-4" />

          <div className="flex items-center gap-2">
            <span
              className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold ${
                step === 'result'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 text-slate-400'
              }`}
            >
              3
            </span>
            <span className={step === 'result' ? 'text-indigo-600 font-bold' : 'text-slate-500'}>
              Import Summary
            </span>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {error && (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-800 flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Import Error</p>
                <p className="text-xs mt-0.5">{error}</p>
              </div>
            </div>
          )}

          {/* STEP 1: Upload & Sample Template */}
          {step === 'upload' && (
            <div className="space-y-6">
              {/* Hierarchy and Guidelines Callout */}
              <div className="bg-indigo-50/70 border border-indigo-100 rounded-xl p-4 text-xs text-indigo-900 space-y-2">
                <div className="flex items-center gap-2 font-semibold text-indigo-800 text-sm">
                  <HelpCircle className="h-4 w-4 text-indigo-600" />
                  Important Data Hierarchy & Import Rules
                </div>
                <p>
                  Existing Hierarchy: <span className="font-semibold">Primary Item → Category → Group Level → Stock Item → Batch</span>.
                </p>
                <ul className="list-disc pl-5 space-y-1 text-slate-700">
                  <li>
                    <strong className="text-indigo-900">Stock Item Must Pre-Exist:</strong> The <code className="bg-indigo-100 px-1 py-0.5 rounded text-indigo-800">unique_item</code> (Stock Item) in your Excel file must already be created in the system (e.g. <code>HC_SV_-6/-2</code>, <code>HC_SV_+4/+2</code>). The import will not create new Primary Items.
                  </li>
                  <li>
                    <strong className="text-indigo-900">Power Configuration:</strong> Supports standard optical power strings such as <code>-6.00/-2.00</code>, <code>+1.75/-2.00/90/+2.00</code>, or individual SPH/CYL/AXIS/ADD/SIDE columns.
                  </li>
                  <li>
                    <strong className="text-indigo-900">Stock & Pricing:</strong> Opening stock quantity will be initialized in the stock ledger. Existing pricing structures for the Stock Item are preserved.
                  </li>
                </ul>
              </div>

              {/* Download Sample Button Box */}
              <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl p-4">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold">
                    XLS
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-slate-800">
                      Standard Optical Batch Excel Template
                    </h4>
                    <p className="text-xs text-slate-500">
                      Pre-formatted template with sample power rows, SKU mappings, and stock columns.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  id="btn-download-sample-excel"
                  onClick={handleDownloadTemplate}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-300 rounded-lg hover:bg-emerald-100 transition-colors cursor-pointer shadow-2xs"
                >
                  <Download className="h-4 w-4" />
                  Download Sample Excel
                </button>
              </div>

              {/* Drag & Drop Upload Zone */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${
                  isDragging
                    ? 'border-indigo-500 bg-indigo-50/50 scale-[1.01]'
                    : file
                    ? 'border-emerald-500 bg-emerald-50/30'
                    : 'border-slate-300 hover:border-indigo-400 bg-slate-50/50 hover:bg-slate-50'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      handleFileSelect(e.target.files[0]);
                    }
                  }}
                />

                <div className="flex flex-col items-center justify-center space-y-3">
                  <div
                    className={`h-14 w-14 rounded-2xl flex items-center justify-center shadow-xs ${
                      file ? 'bg-emerald-100 text-emerald-600' : 'bg-indigo-100 text-indigo-600'
                    }`}
                  >
                    {file ? <CheckCircle2 className="h-8 w-8" /> : <Upload className="h-8 w-8" />}
                  </div>

                  {file ? (
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{file.name}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {(file.size / 1024).toFixed(1)} KB — Click or drag another file to replace
                      </p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-sm font-semibold text-slate-700">
                        Click to browse or drag and drop your spreadsheet here
                      </p>
                      <p className="text-xs text-slate-400 mt-1">Supports .xlsx, .xls, and .csv files (max 10MB)</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: Validate & Preview */}
          {step === 'preview' && validationData && (
            <div className="space-y-5">
              {/* Stats Summary Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5">
                  <span className="text-xs font-medium text-slate-500">Total Rows</span>
                  <p className="text-2xl font-bold text-slate-900 mt-1">{validationData.totalRows}</p>
                </div>

                <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-3.5">
                  <span className="text-xs font-medium text-emerald-700 flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Valid & Ready
                  </span>
                  <p className="text-2xl font-bold text-emerald-700 mt-1">{validationData.validRows}</p>
                </div>

                <div className="bg-rose-50/70 border border-rose-200 rounded-xl p-3.5">
                  <span className="text-xs font-medium text-rose-700 flex items-center gap-1.5">
                    <XCircle className="h-3.5 w-3.5" /> Invalid / Errors
                  </span>
                  <p className="text-2xl font-bold text-rose-700 mt-1">{validationData.invalidRows}</p>
                </div>

                <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-3.5">
                  <span className="text-xs font-medium text-amber-700 flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5" /> Duplicates
                  </span>
                  <p className="text-2xl font-bold text-amber-700 mt-1">{validationData.duplicateRows}</p>
                </div>
              </div>

              {/* Filter Tabs & Error Report Button */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
                <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs">
                  <button
                    onClick={() => setPreviewFilter('all')}
                    className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
                      previewFilter === 'all' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    All Rows ({validationData.totalRows})
                  </button>
                  <button
                    onClick={() => setPreviewFilter('valid')}
                    className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
                      previewFilter === 'valid' ? 'bg-white text-emerald-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Valid ({validationData.validRows})
                  </button>
                  <button
                    onClick={() => setPreviewFilter('errors')}
                    className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
                      previewFilter === 'errors' ? 'bg-white text-rose-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Errors ({validationData.invalidRows})
                  </button>
                  {validationData.duplicateRows > 0 && (
                    <button
                      onClick={() => setPreviewFilter('duplicates')}
                      className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
                        previewFilter === 'duplicates' ? 'bg-white text-amber-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Duplicates ({validationData.duplicateRows})
                    </button>
                  )}
                </div>

                {validationData.invalidRows > 0 && (
                  <button
                    onClick={() => handleDownloadErrorReport(validationData.sessionId)}
                    disabled={downloadingErrors}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg hover:bg-rose-100 transition-colors cursor-pointer"
                  >
                    <Download className="h-3.5 w-3.5" />
                    {downloadingErrors ? 'Downloading...' : 'Download Error Report (.xlsx)'}
                  </button>
                )}
              </div>

              {/* Rows Preview Table */}
              <div className="border border-slate-200 rounded-xl overflow-hidden shadow-xs">
                <div className="max-h-[320px] overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50/80 sticky top-0 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider">
                      <tr>
                        <th className="px-3 py-2.5">Row</th>
                        <th className="px-3 py-2.5">Status</th>
                        <th className="px-3 py-2.5">Stock Item</th>
                        <th className="px-3 py-2.5">Power Specification</th>
                        <th className="px-3 py-2.5">SKU</th>
                        <th className="px-3 py-2.5 text-right">Opening Qty</th>
                        <th className="px-3 py-2.5 text-right">Cost / MRP</th>
                        <th className="px-3 py-2.5">Validation Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredRows.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                            No rows match the selected filter.
                          </td>
                        </tr>
                      ) : (
                        filteredRows.map((row) => (
                          <tr
                            key={row.rowNumber}
                            className={`hover:bg-slate-50/60 ${
                              !row.isValid ? 'bg-rose-50/20' : row.isDuplicate ? 'bg-amber-50/20' : ''
                            }`}
                          >
                            <td className="px-3 py-2 font-mono font-bold text-slate-600">
                              #{row.rowNumber}
                            </td>
                            <td className="px-3 py-2">
                              {row.isValid ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-800">
                                  <CheckCircle2 className="h-3 w-3" /> Valid
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-100 text-rose-800">
                                  <XCircle className="h-3 w-3" /> Error
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {row.resolvedData?.uniqueItem ? (
                                <span className="font-semibold text-slate-800">
                                  {row.resolvedData.uniqueItem.name}
                                </span>
                              ) : (
                                <span className="text-rose-600 font-mono text-[11px]">
                                  {row.mapped.unique_item || row.mapped.uniqueItem || '(Missing)'}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {row.resolvedData?.powers ? (
                                <span className="font-mono font-medium text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded">
                                  {row.resolvedData.powers.identityKey}
                                </span>
                              ) : (
                                <span className="text-slate-500 font-mono">
                                  {row.mapped.batch_name || row.mapped.batchName || '-'}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 font-mono text-slate-700">
                              {row.resolvedData?.sku || row.mapped.sku || '-'}
                            </td>
                            <td className="px-3 py-2 text-right font-medium text-slate-800">
                              {row.resolvedData?.openingStockQuantity !== undefined
                                ? `${row.resolvedData.openingStockQuantity} ${row.resolvedData.unit || 'prs'}`
                                : '-'}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-slate-600">
                              ₹{row.resolvedData?.purchaseCost || 0} / ₹{row.resolvedData?.sellingPrice || 0}
                            </td>
                            <td className="px-3 py-2 max-w-xs">
                              {row.errors.length > 0 ? (
                                <div className="space-y-0.5">
                                  {row.errors.map((err, idx) => (
                                    <div
                                      key={idx}
                                      className={`text-[11px] leading-tight ${
                                        err.severity === 'ERROR' ? 'text-rose-700 font-medium' : 'text-amber-700'
                                      }`}
                                    >
                                      • {err.message}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-slate-400 text-[11px]">Passes all validation checks</span>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: Result Summary */}
          {step === 'result' && postingResult && (
            <div className="space-y-6 text-center py-4">
              <div
                className={`h-16 w-16 mx-auto rounded-full flex items-center justify-center ${
                  postingResult.status === 'COMPLETED'
                    ? 'bg-emerald-100 text-emerald-600'
                    : 'bg-amber-100 text-amber-600'
                }`}
              >
                <CheckCircle2 className="h-10 w-10" />
              </div>

              <div>
                <h3 className="text-xl font-bold text-slate-900">
                  {postingResult.status === 'COMPLETED'
                    ? 'Import Completed Successfully!'
                    : 'Import Completed with Some Warnings/Errors'}
                </h3>
                <p className="text-sm text-slate-500 mt-1">
                  Optical batches and opening stock balances have been updated and committed to the database.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-4 max-w-lg mx-auto">
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                  <span className="text-xs text-slate-500 font-medium">Total Rows</span>
                  <p className="text-2xl font-bold text-slate-900 mt-1">{postingResult.totalRows}</p>
                </div>
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                  <span className="text-xs text-emerald-700 font-medium">Posted Batches</span>
                  <p className="text-2xl font-bold text-emerald-700 mt-1">{postingResult.postedRows}</p>
                </div>
                <div className="bg-rose-50 border border-rose-200 rounded-xl p-4">
                  <span className="text-xs text-rose-700 font-medium">Skipped / Failed</span>
                  <p className="text-2xl font-bold text-rose-700 mt-1">{postingResult.failedRows}</p>
                </div>
              </div>

              {postingResult.failedRows > 0 && (
                <div className="pt-2">
                  <button
                    onClick={() => handleDownloadErrorReport(postingResult.sessionId)}
                    className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg hover:bg-rose-100 transition-colors cursor-pointer"
                  >
                    <Download className="h-4 w-4" />
                    Download Error Report (.xlsx)
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50/70 flex items-center justify-between">
          {step === 'upload' && (
            <>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200/60 rounded-lg transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleUploadAndValidate}
                disabled={!file || loading}
                className="inline-flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-xs transition-colors cursor-pointer"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                {loading ? 'Validating Data...' : 'Upload & Validate Preview'}
              </button>
            </>
          )}

          {step === 'preview' && (
            <>
              <button
                type="button"
                onClick={handleReset}
                className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200/60 rounded-lg transition-colors cursor-pointer"
              >
                Upload Different File
              </button>
              <button
                type="button"
                onClick={handlePostImport}
                disabled={!validationData?.validRows || loading}
                className="inline-flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-xs transition-colors cursor-pointer"
              >
                <CheckCircle2 className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                {loading
                  ? 'Importing Batches...'
                  : `Import Valid Batches (${validationData?.validRows || 0})`}
              </button>
            </>
          )}

          {step === 'result' && (
            <div className="w-full flex justify-end">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  handleReset();
                }}
                className="px-6 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 shadow-xs transition-colors cursor-pointer"
              >
                Done & View Batches
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
