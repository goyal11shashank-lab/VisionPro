import React, { useRef, useState } from 'react';
import { ScanBarcode } from 'lucide-react';

interface BarcodeScanBoxProps {
  onScan: (code: string) => void;
  pending: number;
  scannedCount: number;
  status: { type: 'success' | 'error'; text: string } | null;
}

/**
 * One common scan box for the voucher. Scan or type a barcode and press Enter (scanners send Enter).
 * The box clears at once and stays focused, so scans can follow each other without waiting.
 */
export const BarcodeScanBox: React.FC<BarcodeScanBoxProps> = ({ onScan, pending, scannedCount, status }) => {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLInputElement>(null);

  const submit = () => {
    const code = value.trim();
    if (!code) return;
    setValue('');
    onScan(code);
    ref.current?.focus();
  };

  return (
    <div className="flex items-start gap-1.5" id="voucher-barcode-scan">
      <span className="text-slate-900 font-extrabold shrink-0 pt-1 text-right w-16 text-[11px] uppercase tracking-tight">
        Scan:
      </span>
      <div className="flex-1 min-w-0">
        <div className="relative">
          <ScanBarcode className="w-3.5 h-3.5 text-slate-500 absolute left-2 top-1/2 -translate-y-1/2" />
          <input
            id="voucher-barcode-scan-input"
            ref={ref}
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Scan barcode here (item and power are added automatically)"
            className="w-full pl-7 pr-2 py-1 text-xs font-mono font-bold text-slate-900 border border-slate-300 rounded bg-white focus:ring-1 focus:ring-blue-600 placeholder:font-sans placeholder:font-normal placeholder:text-slate-400 shadow-2xs"
          />
        </div>
        <div className="flex items-center justify-between gap-2 mt-0.5 min-h-[16px] text-[11px]">
          <span
            id="voucher-barcode-scan-status"
            className={`truncate font-semibold ${
              status ? (status.type === 'error' ? 'text-rose-700' : 'text-emerald-700') : 'text-slate-400'
            }`}
          >
            {status ? status.text : 'Ready'}
          </span>
          <span className="shrink-0 font-mono text-slate-500">
            Scanned: {scannedCount}
            {pending > 0 ? ` (${pending} in progress)` : ''}
          </span>
        </div>
      </div>
    </div>
  );
};
