/**
 * Professional Printable Report Component
 * Renders tabular reports (Stock Summary, Ledgers, Registers, Outstanding, GST)
 * Includes business header, active filter summary, formatted columns, totals row, and page break controls.
 */
import React from 'react';
import { Business } from '../../types/index.js';

export interface ReportColumn {
  header: string;
  key: string;
  align?: 'left' | 'center' | 'right';
  width?: string;
  format?: (val: any, row: any) => React.ReactNode;
}

export interface PrintableReportProps {
  business: Business | null;
  reportTitle: string;
  subtitle?: string;
  dateRange?: string;
  filtersSummary?: Record<string, any> | string;
  columns: ReportColumn[];
  data: Record<string, any>[];
  totals?: Record<string, any>;
  orientation?: 'portrait' | 'landscape';
  id?: string;
}

export const PrintableReport: React.FC<PrintableReportProps> = ({
  business,
  reportTitle,
  subtitle,
  dateRange,
  filtersSummary,
  columns,
  data,
  totals,
  orientation = 'portrait',
  id = 'printable-report',
}) => {
  const isLandscape = orientation === 'landscape';

  // Format Filter Summary
  let filterList: { label: string; value: string }[] = [];
  if (typeof filtersSummary === 'string') {
    if (filtersSummary.trim()) {
      filterList.push({ label: 'Filter', value: filtersSummary });
    }
  } else if (filtersSummary && typeof filtersSummary === 'object') {
    filterList = Object.entries(filtersSummary)
      .filter(([_, v]) => v !== undefined && v !== null && v !== '' && v !== 'ALL')
      .map(([k, v]) => ({
        label: k.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase()),
        value: String(v),
      }));
  }

  // Format Business Address
  const businessAddress = [
    business?.addressLine1,
    business?.addressLine2,
    [business?.city, business?.pincode ? `- ${business?.pincode}` : ''].filter(Boolean).join(' '),
    business?.state,
  ].filter(Boolean).join(', ');

  return (
    <div
      id={id}
      className={`print-document-container relative bg-white text-slate-900 mx-auto border border-slate-300 p-6 md:p-8 font-sans text-xs leading-normal shadow-sm ${
        isLandscape ? 'max-w-[297mm]' : 'max-w-[210mm]'
      } min-h-[297mm]`}
      style={{ boxSizing: 'border-box' }}
    >
      {/* Top Header: Business Branding & Report Name */}
      <div className="border-b-2 border-slate-800 pb-3 mb-3">
        <div className="flex justify-between items-start gap-4">
          <div>
            <h1 className="text-lg font-black text-slate-950 uppercase tracking-tight">
              {business?.name || 'Optical ERP'}
            </h1>
            {businessAddress && (
              <div className="text-slate-600 text-[10px] mt-0.5">{businessAddress}</div>
            )}
            <div className="flex flex-wrap items-center gap-x-3 text-[10px] text-slate-700 mt-0.5">
              {business?.gstin && (
                <div>
                  <span className="text-slate-500">GSTIN:</span> <span className="font-mono font-bold">{business.gstin}</span>
                </div>
              )}
              {business?.phone && (
                <div>
                  <span className="text-slate-500">Phone:</span> {business.phone}
                </div>
              )}
              {business?.email && (
                <div>
                  <span className="text-slate-500">Email:</span> {business.email}
                </div>
              )}
            </div>
          </div>

          <div className="text-right">
            <h2 className="text-base font-black text-slate-950 uppercase tracking-wide">
              {reportTitle}
            </h2>
            {subtitle && (
              <div className="text-xs font-semibold text-slate-600 mt-0.5">{subtitle}</div>
            )}
            {dateRange && (
              <div className="text-[11px] font-mono text-slate-700 mt-0.5">
                Period: <span className="font-semibold">{dateRange}</span>
              </div>
            )}
            <div className="text-[9px] text-slate-500 mt-0.5">
              Generated on: {new Date().toLocaleString('en-IN')}
            </div>
          </div>
        </div>
      </div>

      {/* Applied Filters Summary Banner */}
      {filterList.length > 0 && (
        <div className="mb-3 p-2 bg-slate-50 border border-slate-200 rounded flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
          <span className="font-bold text-slate-700 uppercase tracking-wider text-[9px]">
            Applied Filters:
          </span>
          {filterList.map((f, idx) => (
            <span key={idx} className="bg-white px-2 py-0.5 rounded border border-slate-200 font-medium text-slate-800">
              <span className="text-slate-500">{f.label}:</span> <span className="font-semibold">{f.value}</span>
            </span>
          ))}
        </div>
      )}

      {/* Main Tabular Data */}
      <div className="border border-slate-300 rounded overflow-hidden mb-4">
        <table className="w-full text-left text-[11px] border-collapse">
          <thead className="bg-slate-100 border-b border-slate-300 text-slate-800 font-bold uppercase tracking-wider text-[10px]">
            <tr>
              <th className="py-2 px-2 text-center w-8 border-r border-slate-200">#</th>
              {columns.map((col, idx) => (
                <th
                  key={col.key}
                  style={col.width ? { width: col.width } : undefined}
                  className={`py-2 px-2.5 ${
                    col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'
                  } ${idx < columns.length - 1 ? 'border-r border-slate-200' : ''}`}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 font-mono">
            {data.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1} className="py-8 text-center text-slate-400 font-sans italic">
                  No records found matching the specified report filters.
                </td>
              </tr>
            ) : (
              data.map((row, rowIdx) => (
                <tr key={row.id || rowIdx} className={rowIdx % 2 === 1 ? 'bg-slate-50/50' : 'bg-white'}>
                  <td className="py-1.5 px-2 text-center text-[10px] text-slate-400 font-sans border-r border-slate-200">
                    {rowIdx + 1}
                  </td>
                  {columns.map((col, colIdx) => {
                    const rawVal = row[col.key];
                    const content = col.format ? col.format(rawVal, row) : (rawVal !== null && rawVal !== undefined ? String(rawVal) : '-');

                    return (
                      <td
                        key={col.key}
                        className={`py-1.5 px-2.5 ${
                          col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left font-sans'
                        } ${colIdx < columns.length - 1 ? 'border-r border-slate-200' : ''}`}
                      >
                        {content}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>

          {/* Totals Row if provided */}
          {totals && data.length > 0 && (
            <tfoot className="bg-slate-100 border-t-2 border-slate-400 font-mono font-bold text-slate-900">
              <tr>
                <td className="py-2 px-2 text-center border-r border-slate-200 font-sans text-[10px]">TOTAL</td>
                {columns.map((col, colIdx) => {
                  const totalVal = totals[col.key];
                  const displayTotal = totalVal !== undefined ? (typeof totalVal === 'number' ? totalVal.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : String(totalVal)) : '';

                  return (
                    <td
                      key={col.key}
                      className={`py-2 px-2.5 ${
                        col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'
                      } ${colIdx < columns.length - 1 ? 'border-r border-slate-200' : ''}`}
                    >
                      {displayTotal}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Record Count & Page Footer */}
      <div className="flex justify-between items-center text-[9px] text-slate-500 pt-2 border-t border-slate-200 avoid-break">
        <div>
          Total Records: <span className="font-bold text-slate-800">{data.length}</span>
        </div>
        <div>Generated from {business?.name || 'Optical ERP'}</div>
      </div>
    </div>
  );
};
