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
  HelpCircle,
  Layers,
  Sparkles,
  Edit3,
  PlusCircle,
  Check,
  FileDown,
} from 'lucide-react';
import { apiRequest, getStoredToken } from '../../api/client.js';
import { generateClientStockItemTemplate } from '../../utils/excelTemplateGenerator.js';

interface StockItemImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export type ImportMode = 'CREATE_ONLY' | 'UPSERT';

interface ValidationResult {
  sessionId: string;
  fileName: string;
  importType: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  importMode?: ImportMode;
  preview: {
    importMode?: ImportMode;
    rows: Array<{
      rowNumber: number;
      isValid: boolean;
      isDuplicate: boolean;
      raw: Record<string, any>;
      mapped: Record<string, any>;
      resolvedData?: {
        code?: string;
        name?: string;
        opticalCategory?: string;
        maintainBatches?: boolean;
        purchaseRate?: number;
        mrp?: number;
        gstRate?: number;
        status?: string;
        description?: string;
        isUpdate?: boolean;
        existingId?: string;
        parentPrimaryItemName?: string;
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

export const StockItemImportModal: React.FC<StockItemImportModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [step, setStep] = useState<'upload' | 'preview' | 'result'>('upload');
  const [importMode, setImportMode] = useState<ImportMode>('CREATE_ONLY');
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [revalidating, setRevalidating] = useState<boolean>(false);
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
      generateClientStockItemTemplate();
    } catch (err: any) {
      // Fallback to server template
      const token = getStoredToken();
      window.open(`/api/imports/templates/STOCK_ITEM${token ? `?token=${token}` : ''}`, '_blank');
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
      a.download = `Error_Report_Stock_Items_${sessionId.slice(0, 8)}.xlsx`;
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
      formData.append('importType', 'STOCK_ITEM');
      formData.append('importMode', importMode);

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

  const handleSwitchModeAndRevalidate = async (newMode: ImportMode) => {
    if (!validationData?.sessionId) return;
    try {
      setRevalidating(true);
      setError(null);
      setImportMode(newMode);

      const token = getStoredToken();
      const response = await fetch(`/api/imports/${validationData.sessionId}/revalidate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          importMode: newMode,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Re-validation failed.');
      }

      setValidationData((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          importMode: newMode,
          validRows: data.validation.validRows,
          invalidRows: data.validation.invalidRows,
          duplicateRows: data.validation.duplicateRows,
          preview: data.validation,
        };
      });
    } catch (err: any) {
      setError(err.message || 'Failed to re-validate with new mode');
    } finally {
      setRevalidating(false);
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
      onSuccess(); // Trigger parent table refresh
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

  const validNewCount = rows.filter((r) => r.isValid && !r.resolvedData?.isUpdate).length;
  const validUpdateCount = rows.filter((r) => r.isValid && r.resolvedData?.isUpdate).length;

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
                Bulk Import Stock Items — Excel
              </h2>
              <p className="text-xs text-slate-500">
                Create new stock items or update pricing and metadata in bulk with built-in safety rules.
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
              Upload & Mode Configuration
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

          {/* STEP 1: Upload & Mode Configuration */}
          {step === 'upload' && (
            <div className="space-y-6">
              {/* Import Mode Selector */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Import Mode
                  </span>
                  <span className="text-xs text-slate-400">Select how duplicate item codes are handled</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label
                    className={`flex items-start gap-3 p-3.5 rounded-xl border-2 cursor-pointer transition-all ${
                      importMode === 'CREATE_ONLY'
                        ? 'border-indigo-600 bg-indigo-50/50 shadow-xs'
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <input
                      type="radio"
                      name="importMode"
                      checked={importMode === 'CREATE_ONLY'}
                      onChange={() => setImportMode('CREATE_ONLY')}
                      className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
                    />
                    <div>
                      <span className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                        <PlusCircle className="h-4 w-4 text-indigo-600" />
                        Create Only
                      </span>
                      <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                        Only import new Stock Items. If a row matches an existing Stock Item Code, it will be flagged as an error to prevent accidental changes.
                      </p>
                    </div>
                  </label>

                  <label
                    className={`flex items-start gap-3 p-3.5 rounded-xl border-2 cursor-pointer transition-all ${
                      importMode === 'UPSERT'
                        ? 'border-indigo-600 bg-indigo-50/50 shadow-xs'
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <input
                      type="radio"
                      name="importMode"
                      checked={importMode === 'UPSERT'}
                      onChange={() => setImportMode('UPSERT')}
                      className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
                    />
                    <div>
                      <span className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                        <Edit3 className="h-4 w-4 text-emerald-600" />
                        Create or Update (Upsert)
                      </span>
                      <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                        Updates existing Stock Items (rates, MRP, name, description) when the Code exists, or inserts new items if not found. Protected safety checks apply.
                      </p>
                    </div>
                  </label>
                </div>
              </div>

              {/* Guidelines Callout */}
              <div className="bg-indigo-50/70 border border-indigo-100 rounded-xl p-4 text-xs text-indigo-900 space-y-2">
                <div className="flex items-center gap-2 font-semibold text-indigo-800 text-sm">
                  <HelpCircle className="h-4 w-4 text-indigo-600" />
                  Stock Item Fields & Safety Rules
                </div>
                <ul className="list-disc pl-5 space-y-1.5 text-slate-700">
                  <li>
                    <strong className="text-indigo-900">Mandatory Columns:</strong> <code className="bg-indigo-100 px-1 py-0.5 rounded text-indigo-800">stock_item_code</code>, <code className="bg-indigo-100 px-1 py-0.5 rounded text-indigo-800">stock_item_name</code>, <code className="bg-indigo-100 px-1 py-0.5 rounded text-indigo-800">category</code> (SV, KT, PROG, CONTACT_LENS, FRAME, SUNGLASS, ACCESSORY, OTHER), and <code className="bg-indigo-100 px-1 py-0.5 rounded text-indigo-800">maintain_batches</code> (YES/NO).
                  </li>
                  <li>
                    <strong className="text-indigo-900">Maintain Batches Safety:</strong> If an existing Stock Item has <span className="font-semibold">Maintain Batches = YES</span> and already has inventory or batch history, Excel cannot turn it to <span className="font-semibold">NO</span>.
                  </li>
                  <li>
                    <strong className="text-indigo-900">Category Protection:</strong> If an existing batch-maintained Stock Item already has generated batches, its category cannot be changed via import.
                  </li>
                  <li>
                    <strong className="text-indigo-900">GST Rate & Pricing:</strong> GST Rate defaults to 5.00% if not specified. Purchase Rate and MRP accept numeric currency values (e.g. 450.00).
                  </li>
                  <li>
                    <strong className="text-indigo-900">Scope Notice:</strong> This import creates or updates Stock Item masters only. To import power combinations and initial opening stock, use the Optical Batches bulk import.
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
                      Sample Stock Items Excel Template
                    </h4>
                    <p className="text-xs text-slate-500">
                      Contains pre-filled examples for single vision lenses, accessories, and cleaning solutions with complete validation instructions.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  id="btn-download-stock-item-template"
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
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-emerald-700 flex items-center gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Valid & Ready
                    </span>
                    <span className="text-[11px] font-semibold text-emerald-600">
                      {validNewCount} New / {validUpdateCount} Update
                    </span>
                  </div>
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

              {/* Mode Toggle & Filter Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/80 p-3 rounded-xl border border-slate-200">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-700">Mode:</span>
                  <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 shadow-2xs text-xs">
                    <button
                      type="button"
                      disabled={revalidating}
                      onClick={() => handleSwitchModeAndRevalidate('CREATE_ONLY')}
                      className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                        importMode === 'CREATE_ONLY'
                          ? 'bg-indigo-600 text-white shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Create Only
                    </button>
                    <button
                      type="button"
                      disabled={revalidating}
                      onClick={() => handleSwitchModeAndRevalidate('UPSERT')}
                      className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                        importMode === 'UPSERT'
                          ? 'bg-indigo-600 text-white shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Create or Update (Upsert)
                    </button>
                  </div>
                  {revalidating && (
                    <span className="text-xs text-indigo-600 flex items-center gap-1 animate-pulse">
                      <RefreshCw className="h-3 w-3 animate-spin" /> Re-validating...
                    </span>
                  )}
                </div>

                {validationData.invalidRows > 0 && (
                  <button
                    type="button"
                    onClick={() => handleDownloadErrorReport(validationData.sessionId)}
                    disabled={downloadingErrors}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg hover:bg-rose-100 transition-colors cursor-pointer"
                  >
                    <FileDown className="h-3.5 w-3.5" />
                    {downloadingErrors ? 'Downloading...' : `Download Error Report (${validationData.invalidRows})`}
                  </button>
                )}
              </div>

              {/* Filter Tabs */}
              <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs w-fit">
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

              {/* Preview Table */}
              <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
                <div className="max-h-[380px] overflow-y-auto">
                  <table className="w-full text-left text-xs text-slate-700">
                    <thead className="bg-slate-50/90 sticky top-0 z-10 text-[11px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200">
                      <tr>
                        <th className="py-2.5 px-3">#</th>
                        <th className="py-2.5 px-3">Action</th>
                        <th className="py-2.5 px-3">Code</th>
                        <th className="py-2.5 px-3">Name</th>
                        <th className="py-2.5 px-3">Category</th>
                        <th className="py-2.5 px-3">Batches</th>
                        <th className="py-2.5 px-3">Purchase Rate</th>
                        <th className="py-2.5 px-3">MRP</th>
                        <th className="py-2.5 px-3">GST %</th>
                        <th className="py-2.5 px-3">Status</th>
                        <th className="py-2.5 px-3">Validation Message</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredRows.length === 0 ? (
                        <tr>
                          <td colSpan={11} className="py-8 text-center text-slate-400">
                            No rows found in this filter category.
                          </td>
                        </tr>
                      ) : (
                        filteredRows.map((row) => {
                          const isUp = row.resolvedData?.isUpdate;
                          return (
                            <tr
                              key={row.rowNumber}
                              className={
                                !row.isValid
                                  ? 'bg-rose-50/40 hover:bg-rose-50/70'
                                  : isUp
                                  ? 'bg-sky-50/30 hover:bg-sky-50/60'
                                  : 'hover:bg-slate-50/70'
                              }
                            >
                              <td className="py-2.5 px-3 font-mono text-slate-400">
                                {row.rowNumber}
                              </td>
                              <td className="py-2.5 px-3 whitespace-nowrap">
                                {!row.isValid ? (
                                  <span className="inline-flex items-center gap-1 text-rose-700 font-semibold bg-rose-100/80 px-2 py-0.5 rounded text-[11px]">
                                    <XCircle className="h-3 w-3" /> Error
                                  </span>
                                ) : isUp ? (
                                  <span className="inline-flex items-center gap-1 text-sky-700 font-semibold bg-sky-100/80 px-2 py-0.5 rounded text-[11px]">
                                    <Edit3 className="h-3 w-3" /> Update
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold bg-emerald-100/80 px-2 py-0.5 rounded text-[11px]">
                                    <Check className="h-3 w-3" /> New
                                  </span>
                                )}
                              </td>
                              <td className="py-2.5 px-3 font-mono font-medium text-slate-900">
                                {row.resolvedData?.code || row.raw['stock_item_code'] || '-'}
                              </td>
                              <td className="py-2.5 px-3 font-medium text-slate-800 max-w-[200px] truncate" title={row.resolvedData?.name || row.raw['stock_item_name']}>
                                {row.resolvedData?.name || row.raw['stock_item_name'] || '-'}
                              </td>
                              <td className="py-2.5 px-3">
                                <span className="px-1.5 py-0.5 bg-slate-100 rounded font-semibold text-[11px] text-slate-700">
                                  {row.resolvedData?.opticalCategory || row.raw['category'] || '-'}
                                </span>
                              </td>
                              <td className="py-2.5 px-3">
                                {row.resolvedData?.maintainBatches ? (
                                  <span className="text-emerald-700 font-bold">YES</span>
                                ) : (
                                  <span className="text-slate-400 font-medium">NO</span>
                                )}
                              </td>
                              <td className="py-2.5 px-3 font-mono">
                                ₹{row.resolvedData?.purchaseRate !== undefined ? Number(row.resolvedData.purchaseRate).toFixed(2) : '-'}
                              </td>
                              <td className="py-2.5 px-3 font-mono font-semibold text-slate-900">
                                ₹{row.resolvedData?.mrp !== undefined ? Number(row.resolvedData.mrp).toFixed(2) : '-'}
                              </td>
                              <td className="py-2.5 px-3 font-mono">
                                {row.resolvedData?.gstRate !== undefined ? `${row.resolvedData.gstRate}%` : '5%'}
                              </td>
                              <td className="py-2.5 px-3 whitespace-nowrap">
                                <span
                                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                    row.resolvedData?.status === 'INACTIVE'
                                      ? 'bg-slate-100 text-slate-500'
                                      : 'bg-emerald-100 text-emerald-800'
                                  }`}
                                >
                                  {row.resolvedData?.status || 'ACTIVE'}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 text-xs">
                                {row.errors && row.errors.length > 0 ? (
                                  <ul className="space-y-0.5">
                                    {row.errors.map((err, idx) => (
                                      <li
                                        key={idx}
                                        className={`flex items-start gap-1 text-[11px] ${
                                          err.severity === 'ERROR' ? 'text-rose-600 font-medium' : 'text-amber-600'
                                        }`}
                                      >
                                        <span className="shrink-0">•</span>
                                        <span>{err.message}</span>
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <span className="text-emerald-600 font-medium text-[11px] flex items-center gap-1">
                                    <CheckCircle2 className="h-3 w-3" /> Ready
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: Summary / Results */}
          {step === 'result' && postingResult && (
            <div className="space-y-6">
              <div
                className={`p-6 rounded-2xl border text-center space-y-3 ${
                  postingResult.status === 'COMPLETED'
                    ? 'bg-emerald-50/70 border-emerald-200'
                    : postingResult.status === 'COMPLETED_WITH_ERRORS'
                    ? 'bg-amber-50/70 border-amber-200'
                    : 'bg-rose-50/70 border-rose-200'
                }`}
              >
                <div className="flex justify-center">
                  {postingResult.status === 'COMPLETED' ? (
                    <div className="h-16 w-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center">
                      <CheckCircle2 className="h-10 w-10" />
                    </div>
                  ) : (
                    <div className="h-16 w-16 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center">
                      <AlertTriangle className="h-10 w-10" />
                    </div>
                  )}
                </div>

                <h3 className="text-xl font-bold text-slate-900">
                  {postingResult.status === 'COMPLETED'
                    ? 'Stock Items Imported Successfully!'
                    : 'Import Completed With Some Row Issues'}
                </h3>
                <p className="text-sm text-slate-600 max-w-lg mx-auto">
                  {postingResult.postedRows} stock items have been created or updated in the catalog.
                </p>

                <div className="grid grid-cols-3 gap-4 max-w-md mx-auto pt-3">
                  <div className="bg-white/80 border border-slate-200 rounded-xl p-3">
                    <span className="text-xs text-slate-500 font-medium">Total Processed</span>
                    <p className="text-xl font-bold text-slate-800 mt-0.5">{postingResult.totalRows}</p>
                  </div>
                  <div className="bg-white/80 border border-emerald-200 rounded-xl p-3">
                    <span className="text-xs text-emerald-700 font-medium">Posted</span>
                    <p className="text-xl font-bold text-emerald-700 mt-0.5">{postingResult.postedRows}</p>
                  </div>
                  <div className="bg-white/80 border border-rose-200 rounded-xl p-3">
                    <span className="text-xs text-rose-700 font-medium">Failed</span>
                    <p className="text-xl font-bold text-rose-700 mt-0.5">{postingResult.failedRows}</p>
                  </div>
                </div>
              </div>

              {/* Posted Documents List */}
              {postingResult.postedDocuments && postingResult.postedDocuments.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Created / Updated Stock Items ({postingResult.postedDocuments.length})
                  </h4>
                  <div className="max-h-[220px] overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100 bg-white">
                    {postingResult.postedDocuments.map((doc, idx) => (
                      <div key={idx} className="p-3 text-xs flex items-center justify-between hover:bg-slate-50">
                        <div className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full bg-emerald-500" />
                          <span className="font-mono font-bold text-slate-900">{doc.documentNumber}</span>
                          <span className="text-slate-500 text-[11px]">— {doc.summary}</span>
                        </div>
                        <span className="text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded">
                          PROCESSED
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Execution Errors */}
              {postingResult.errors && postingResult.errors.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-rose-700 uppercase tracking-wider">
                    Execution Errors ({postingResult.errors.length})
                  </h4>
                  <div className="max-h-[160px] overflow-y-auto border border-rose-200 rounded-xl divide-y divide-rose-100 bg-rose-50/50 p-3 space-y-1">
                    {postingResult.errors.map((err, idx) => (
                      <p key={idx} className="text-xs text-rose-700">
                        {err.row ? `Row ${err.row}: ` : ''}{err.message}
                      </p>
                    ))}
                  </div>
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
                className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-200/50 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                id="btn-upload-validate-stock-items"
                disabled={!file || loading}
                onClick={handleUploadAndValidate}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shadow-xs transition-all"
              >
                {loading ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Processing Spreadsheet...
                  </>
                ) : (
                  <>
                    Continue to Preview
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </>
          )}

          {step === 'preview' && validationData && (
            <>
              <button
                type="button"
                onClick={handleReset}
                className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-200/50 rounded-lg cursor-pointer"
              >
                Back to Upload
              </button>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  id="btn-post-stock-items"
                  disabled={validationData.validRows === 0 || loading}
                  onClick={handlePostImport}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-emerald-600 rounded-xl hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shadow-xs transition-all"
                >
                  {loading ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      Importing Stock Items...
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4" />
                      {validationData.invalidRows > 0
                        ? `Import ${validationData.validRows} Valid Items`
                        : `Import All ${validationData.validRows} Stock Items`}
                    </>
                  )}
                </button>
              </div>
            </>
          )}

          {step === 'result' && (
            <>
              <button
                type="button"
                onClick={handleReset}
                className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-200/50 rounded-lg cursor-pointer"
              >
                Import Another File
              </button>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center gap-2 px-5 py-2 text-xs font-semibold text-white bg-slate-900 rounded-xl hover:bg-slate-800 cursor-pointer shadow-xs"
              >
                Done
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
