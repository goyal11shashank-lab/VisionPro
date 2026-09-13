/**
 * Professional Printable Voucher Component
 * Supports Sales Invoices, Purchase Invoices, Orders, Returns, and Credit/Debit Notes.
 * Renders A4-compatible print layout with nested multi-batch allocations without duplicating commercial totals.
 */
import React from 'react';
import { Business } from '../../types/index.js';
import { numberToIndianWords } from '../../utils/numberToWords.js';
import { useBusinessSettings } from '../../context/SettingsContext.js';

export type VoucherDocumentType =
  | 'SALES_INVOICE'
  | 'PURCHASE_INVOICE'
  | 'SALES_ORDER'
  | 'PURCHASE_ORDER'
  | 'SALES_RETURN'
  | 'PURCHASE_RETURN'
  | 'RECEIPT'
  | 'PAYMENT';

export interface PrintableVoucherProps {
  business: Business | null;
  voucher: any;
  documentType?: VoucherDocumentType;
  customTitle?: string;
  copyLabel?: string; // e.g. "Original for Recipient", "Duplicate for Transporter"
  showLogo?: boolean;
  showBatches?: boolean;
  showNarration?: boolean;
  showTerms?: boolean;
  showSignatures?: boolean;
  id?: string;
}

export const PrintableVoucher: React.FC<PrintableVoucherProps> = ({
  business,
  voucher,
  documentType = 'SALES_INVOICE',
  customTitle,
  copyLabel = 'Original for Recipient',
  showLogo = true,
  showBatches = true,
  showNarration = true,
  showTerms = true,
  showSignatures = true,
  id = 'printable-voucher',
}) => {
  const { settings } = useBusinessSettings();
  if (!voucher) return null;

  const effectiveShowLogo = showLogo && (settings?.print?.showBusinessLogo ?? true);
  const effectiveShowTerms = showTerms && (settings?.print?.showTermsAndConditions ?? true);
  const effectiveShowSignatures = showSignatures && (settings?.print?.showAuthorizedSignatory ?? true);
  const effectiveShowBatches = showBatches && (settings?.print?.showBatchDetails ?? true);
  const signatoryLabel = settings?.print?.signatoryLabel || 'Authorized Signatory';
  const termsText = settings?.print?.termsAndConditionsText;

  // Determine Title based on document type
  let title = customTitle;
  if (!title) {
    switch (documentType) {
      case 'SALES_INVOICE':
        title = settings?.print?.invoiceTitle || 'TAX INVOICE';
        break;
      case 'PURCHASE_INVOICE':
        title = 'PURCHASE VOUCHER';
        break;
      case 'SALES_ORDER':
        title = 'SALES ORDER';
        break;
      case 'PURCHASE_ORDER':
        title = 'PURCHASE ORDER';
        break;
      case 'SALES_RETURN':
        title = 'CREDIT NOTE / SALES RETURN';
        break;
      case 'PURCHASE_RETURN':
        title = 'DEBIT NOTE / PURCHASE RETURN';
        break;
      case 'RECEIPT':
        title = 'RECEIPT VOUCHER';
        break;
      case 'PAYMENT':
        title = 'PAYMENT VOUCHER';
        break;
      default:
        title = 'COMMERCIAL VOUCHER';
    }
  }

  const isCancelled = voucher.status === 'CANCELLED';
  const isVoid = voucher.status === 'VOID';

  // Format Business Address
  const businessAddress = [
    business?.addressLine1,
    business?.addressLine2,
    [business?.city, business?.pincode ? `- ${business?.pincode}` : ''].filter(Boolean).join(' '),
    business?.state,
  ].filter(Boolean).join(', ');

  // Party Details
  const partyName = voucher.partyName || voucher.party?.name || voucher.party?.displayName || 'Cash Customer';
  const partyAddress = voucher.partyAddress || voucher.party?.address || voucher.party?.billingAddress || '';
  const partyGstin = voucher.partyGstin || voucher.party?.gstin || '';
  const partyState = voucher.partyState || voucher.party?.state || '';
  const partyPhone = voucher.partyPhone || voucher.party?.phone || '';

  // Voucher Details
  const voucherNo = voucher.invoiceNumber || voucher.orderNumber || voucher.returnNumber || voucher.voucherNumber || voucher.id?.slice(0, 8);
  const voucherDate = voucher.invoiceDate || voucher.orderDate || voucher.returnDate || voucher.date || voucher.createdAt;
  const formattedDate = voucherDate ? new Date(voucherDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
  const referenceNo = voucher.referenceNumber || voucher.supplierInvoiceNumber || voucher.refNo || '';
  const sourceOrderNo = voucher.salesOrderNumber || voucher.purchaseOrderNumber || voucher.sourceOrderNumber || '';
  const paymentTerms = voucher.paymentTerms || '';
  const dueDate = voucher.dueDate ? new Date(voucher.dueDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

  // Financial Totals
  const lines: any[] = voucher.lines || [];
  const taxableAmount = parseFloat(String(voucher.taxableAmount || voucher.taxableValue || 0));
  const cgstAmount = parseFloat(String(voucher.cgstAmount || 0));
  const sgstAmount = parseFloat(String(voucher.sgstAmount || 0));
  const igstAmount = parseFloat(String(voucher.igstAmount || 0));
  const totalGst = cgstAmount + sgstAmount + igstAmount;
  const roundOff = parseFloat(String(voucher.roundOff || 0));
  const grandTotal = parseFloat(String(voucher.grandTotal || voucher.totalAmount || voucher.amount || (taxableAmount + totalGst + roundOff)));
  const amountInWords = numberToIndianWords(grandTotal);

  return (
    <div
      id={id}
      className="print-document-container relative bg-white text-slate-900 mx-auto border border-slate-300 p-6 md:p-8 font-sans text-xs leading-relaxed max-w-[210mm] min-h-[297mm] shadow-sm"
      style={{ boxSizing: 'border-box' }}
    >
      {/* Watermark for Cancelled / Void */}
      {(isCancelled || isVoid) && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 overflow-hidden">
          <div className="text-red-500/15 font-black text-7xl md:text-8xl tracking-widest uppercase rotate-[-35deg] select-none border-8 border-red-500/15 px-12 py-4 rounded-3xl">
            {isCancelled ? 'CANCELLED' : 'VOID'}
          </div>
        </div>
      )}

      {/* Top Header: Business Branding & Document Title */}
      <div className="border-b-2 border-slate-800 pb-4 mb-4">
        <div className="flex justify-between items-start gap-4">
          {/* Left: Business Info */}
          <div className="flex-1">
            {showLogo && (business as any)?.logo && (
              <img
                src={(business as any).logo}
                alt="Logo"
                className="h-10 object-contain mb-2"
                referrerPolicy="no-referrer"
              />
            )}
            <h1 className="text-xl font-bold text-slate-950 uppercase tracking-tight">
              {business?.name || 'Optical Enterprise'}
            </h1>
            {business?.tradeName && business?.tradeName !== business?.name && (
              <div className="text-xs font-semibold text-slate-600">({business.tradeName})</div>
            )}
            {businessAddress && (
              <div className="text-slate-600 text-[11px] mt-0.5 max-w-md">{businessAddress}</div>
            )}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[11px] text-slate-700 mt-1 font-medium">
              {business?.gstin && (
                <div>
                  <span className="text-slate-500">GSTIN:</span> <span className="font-mono font-bold">{business.gstin}</span>
                </div>
              )}
              {business?.pan && (
                <div>
                  <span className="text-slate-500">PAN:</span> <span className="font-mono">{business.pan}</span>
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

          {/* Right: Title & Copy Label */}
          <div className="text-right flex flex-col items-end">
            <div className="inline-block bg-slate-900 text-white px-4 py-1 rounded text-sm font-black tracking-wider uppercase">
              {title}
            </div>
            {copyLabel && (
              <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mt-1">
                {copyLabel}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Meta Grid: Voucher Info & Party Info */}
      <div className="grid grid-cols-2 border border-slate-300 rounded overflow-hidden mb-4 divide-x divide-slate-300">
        {/* Left: Party / Customer / Supplier */}
        <div className="p-3 bg-slate-50/50">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
            {documentType.startsWith('PURCHASE') ? 'Supplier (Bill From):' : 'Billed To (Customer):'}
          </div>
          <div className="font-bold text-sm text-slate-950">{partyName}</div>
          {partyAddress && <div className="text-slate-600 text-[11px] mt-0.5">{partyAddress}</div>}
          <div className="mt-1 space-y-0.5 text-[11px] text-slate-700">
            {partyGstin && (
              <div>
                <span className="text-slate-500">GSTIN:</span> <span className="font-mono font-bold">{partyGstin}</span>
              </div>
            )}
            {partyState && (
              <div>
                <span className="text-slate-500">State / Place of Supply:</span> <span className="font-medium">{partyState}</span>
              </div>
            )}
            {partyPhone && (
              <div>
                <span className="text-slate-500">Contact:</span> {partyPhone}
              </div>
            )}
          </div>
        </div>

        {/* Right: Voucher Meta Details */}
        <div className="p-3 bg-slate-50/50 flex flex-col justify-between">
          <div className="space-y-1 text-[11px]">
            <div className="flex justify-between">
              <span className="text-slate-500 font-medium">Voucher / Invoice No:</span>
              <span className="font-mono font-bold text-slate-950 text-xs">{voucherNo}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500 font-medium">Date:</span>
              <span className="font-mono font-semibold text-slate-800">{formattedDate}</span>
            </div>
            {referenceNo && (
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Ref / PO No:</span>
                <span className="font-mono text-slate-800">{referenceNo}</span>
              </div>
            )}
            {sourceOrderNo && (
              <div className="flex justify-between text-emerald-800 bg-emerald-50 px-1 py-0.5 rounded border border-emerald-100">
                <span className="font-medium">Against Order:</span>
                <span className="font-mono font-bold">{sourceOrderNo}</span>
              </div>
            )}
            {paymentTerms && (
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Payment Terms:</span>
                <span className="font-semibold text-slate-800">{paymentTerms}</span>
              </div>
            )}
            {dueDate && (
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Due Date:</span>
                <span className="font-mono text-slate-800">{dueDate}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Item Table with Nested Multi-Batch Allocation Breakdown */}
      <div className="border border-slate-300 rounded overflow-hidden mb-4">
        <table className="w-full text-left text-[11px] border-collapse">
          <thead className="bg-slate-100 border-b border-slate-300 text-slate-800 font-bold uppercase tracking-wider text-[10px]">
            <tr>
              <th className="py-2 px-2.5 w-8 text-center border-r border-slate-200">#</th>
              <th className="py-2 px-3 border-r border-slate-200">Stock Item &amp; Optical Details</th>
              <th className="py-2 px-2.5 text-center w-16 border-r border-slate-200">Qty</th>
              <th className="py-2 px-2 text-center w-12 border-r border-slate-200">Unit</th>
              <th className="py-2 px-2.5 text-right w-20 border-r border-slate-200">Rate (₹)</th>
              <th className="py-2 px-2 text-right w-16 border-r border-slate-200">Taxable</th>
              <th className="py-2 px-2 text-right w-14 border-r border-slate-200">GST</th>
              <th className="py-2 px-3 text-right w-24">Amount (₹)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 font-mono">
            {lines.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-6 text-center text-slate-400 font-sans italic">
                  No line items found in this voucher.
                </td>
              </tr>
            ) : (
              lines.map((l: any, idx: number) => {
                const itemName = l.uniqueItemName || l.uniqueItem?.name || l.itemName || l.description || 'Optical Lens';
                const itemCode = l.uniqueItemCode || l.uniqueItem?.code || l.itemCode;
                const unit = l.unit || l.uniqueItem?.unit || 'PRS';
                const qty = parseFloat(String(l.quantity || 1));
                const rate = parseFloat(String(l.rate || l.unitPrice || 0));
                const taxable = parseFloat(String(l.taxableAmount || (qty * rate)));
                const gstRate = l.gstRate ? `${l.gstRate}%` : '';
                const totalTax = (parseFloat(String(l.cgstAmount || 0)) + parseFloat(String(l.sgstAmount || 0)) + parseFloat(String(l.igstAmount || 0)));
                const lineTot = parseFloat(String(l.lineTotal || (taxable + totalTax)));
                const batches: any[] = l.batches || [];

                return (
                  <React.Fragment key={l.id || idx}>
                    {/* Main Commercial Item Row */}
                    <tr className="bg-white">
                      <td className="py-2 px-2 text-center font-sans text-slate-500 border-r border-slate-200 align-top">
                        {idx + 1}
                      </td>
                      <td className="py-2 px-3 font-sans border-r border-slate-200 align-top">
                        <div className="font-bold text-slate-950 flex items-center gap-2 flex-wrap">
                          <span>{itemName}</span>
                          {itemCode && (
                            <span className="text-[10px] font-mono px-1 py-0.2 bg-slate-100 text-slate-600 rounded">
                              {itemCode}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2 px-2.5 text-center font-bold text-slate-900 border-r border-slate-200 align-top">
                        {qty}
                      </td>
                      <td className="py-2 px-2 text-center font-sans text-slate-600 border-r border-slate-200 align-top">
                        {unit}
                      </td>
                      <td className="py-2 px-2.5 text-right text-slate-800 border-r border-slate-200 align-top">
                        {rate.toFixed(2)}
                      </td>
                      <td className="py-2 px-2 text-right text-slate-800 border-r border-slate-200 align-top">
                        {taxable.toFixed(2)}
                      </td>
                      <td className="py-2 px-2 text-right text-slate-600 border-r border-slate-200 align-top">
                        {gstRate || (totalTax > 0 ? `₹${totalTax.toFixed(1)}` : '0%')}
                      </td>
                      <td className="py-2 px-3 text-right font-bold text-slate-950 align-top">
                        {lineTot.toFixed(2)}
                      </td>
                    </tr>

                    {/* Multi-Batch Optical Allocations Nested Row */}
                    {showBatches && batches.length > 0 && (
                      <tr className="bg-slate-50/70 text-[10px]">
                        <td className="border-r border-slate-200"></td>
                        <td colSpan={7} className="py-1 px-3">
                          <div className="font-sans font-semibold text-slate-500 uppercase tracking-wider text-[9px] mb-0.5">
                            Allocated Optical Batches:
                          </div>
                          <div className="space-y-0.5 pl-2 border-l-2 border-slate-300">
                            {batches.map((b: any, bIdx: number) => {
                              const sph = b.sph ?? b.batch?.sph ?? '0.00';
                              const cyl = b.cyl ?? b.batch?.cyl ?? '0.00';
                              const axis = b.axis ?? b.batch?.axis;
                              const add = b.add ?? b.batch?.add;
                              const side = b.side ?? b.batch?.side;
                              const barcode = b.barcode ?? b.batch?.barcode;
                              const batchQty = b.quantity || 1;

                              return (
                                <div key={bIdx} className="flex flex-wrap items-center gap-x-2 text-slate-700">
                                  <span className="font-bold text-slate-900">
                                    SPH {sph}, CYL {cyl}{axis ? `, AXIS ${axis}` : ''}{add ? `, ADD ${add}` : ''}
                                  </span>
                                  {side && side !== 'NONE' && (
                                    <span className="px-1 py-0.2 bg-blue-100 text-blue-800 text-[9px] font-bold rounded">
                                      {side}
                                    </span>
                                  )}
                                  {batches.length > 1 && (
                                    <span className="text-slate-500 font-semibold font-sans">
                                      ({batchQty} {unit})
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Bottom Summary: GST Breakdown & Commercial Totals */}
      <div className="grid grid-cols-2 gap-4 mb-4 avoid-break">
        {/* Left: GST Tax Analysis Table */}
        <div className="border border-slate-300 rounded p-2.5 bg-slate-50/40 text-[10px]">
          <div className="font-bold text-slate-700 uppercase tracking-wider mb-1">
            Tax Breakdown (GST Snapshot)
          </div>
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-1">Tax Component</th>
                <th className="py-1 text-right">Taxable</th>
                <th className="py-1 text-right">Amount (₹)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono">
              {cgstAmount > 0 && (
                <tr>
                  <td className="py-0.5">Central GST (CGST)</td>
                  <td className="py-0.5 text-right">₹{taxableAmount.toFixed(2)}</td>
                  <td className="py-0.5 text-right font-semibold">₹{cgstAmount.toFixed(2)}</td>
                </tr>
              )}
              {sgstAmount > 0 && (
                <tr>
                  <td className="py-0.5">State GST (SGST)</td>
                  <td className="py-0.5 text-right">₹{taxableAmount.toFixed(2)}</td>
                  <td className="py-0.5 text-right font-semibold">₹{sgstAmount.toFixed(2)}</td>
                </tr>
              )}
              {igstAmount > 0 && (
                <tr>
                  <td className="py-0.5">Integrated GST (IGST)</td>
                  <td className="py-0.5 text-right">₹{taxableAmount.toFixed(2)}</td>
                  <td className="py-0.5 text-right font-semibold">₹{igstAmount.toFixed(2)}</td>
                </tr>
              )}
              {cgstAmount === 0 && sgstAmount === 0 && igstAmount === 0 && (
                <tr>
                  <td className="py-0.5 text-slate-400 italic">No GST Applicable / Zero Rated</td>
                  <td className="py-0.5 text-right">₹{taxableAmount.toFixed(2)}</td>
                  <td className="py-0.5 text-right">₹0.00</td>
                </tr>
              )}
            </tbody>
            <tfoot className="border-t border-slate-300 font-mono font-bold">
              <tr>
                <td className="pt-1">Total Tax</td>
                <td className="pt-1 text-right">₹{taxableAmount.toFixed(2)}</td>
                <td className="pt-1 text-right">₹{totalGst.toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Right: Commercial Totals */}
        <div className="border border-slate-300 rounded p-3 bg-slate-50 flex flex-col justify-between font-mono text-[11px]">
          <div className="space-y-1">
            <div className="flex justify-between text-slate-600 font-sans">
              <span>Taxable Subtotal:</span>
              <span className="font-mono">₹{taxableAmount.toFixed(2)}</span>
            </div>
            {cgstAmount > 0 && (
              <div className="flex justify-between text-slate-600 font-sans">
                <span>CGST:</span>
                <span className="font-mono">₹{cgstAmount.toFixed(2)}</span>
              </div>
            )}
            {sgstAmount > 0 && (
              <div className="flex justify-between text-slate-600 font-sans">
                <span>SGST:</span>
                <span className="font-mono">₹{sgstAmount.toFixed(2)}</span>
              </div>
            )}
            {igstAmount > 0 && (
              <div className="flex justify-between text-slate-600 font-sans">
                <span>IGST:</span>
                <span className="font-mono">₹{igstAmount.toFixed(2)}</span>
              </div>
            )}
            {roundOff !== 0 && (
              <div className="flex justify-between text-slate-600 font-sans">
                <span>Round Off:</span>
                <span className="font-mono">{roundOff > 0 ? `+₹${roundOff.toFixed(2)}` : `-₹${Math.abs(roundOff).toFixed(2)}`}</span>
              </div>
            )}
          </div>

          <div className="border-t-2 border-slate-800 pt-1.5 mt-2 flex justify-between items-baseline">
            <span className="text-xs font-bold text-slate-900 font-sans uppercase">Grand Total:</span>
            <span className="text-base font-black text-slate-950">
              ₹{grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>
      </div>

      {/* Amount in Words */}
      <div className="bg-slate-100/80 border border-slate-200 rounded p-2.5 mb-4 text-[11px] avoid-break">
        <span className="text-slate-500 font-semibold uppercase text-[10px] mr-2">Amount in Words:</span>
        <span className="font-bold text-slate-900">{amountInWords}</span>
      </div>

      {/* Narration / Terms / Remarks */}
      {(() => {
        const cleanedNotes = (voucher.notes || '')
          .replace(/(?:\|\s*)?Payment Mode:\s*[^|]+/gi, '')
          .replace(/(?:\|\s*)?Terms:\s*[^|]+/gi, '')
          .replace(/^[\s|]+|[\s|]+$/g, '')
          .replace(/\|\s*\|/g, '|')
          .trim();
        return showNarration && cleanedNotes ? (
          <div className="mb-4 text-[11px] text-slate-700 avoid-break">
            <span className="font-bold text-slate-900">Narration / Remarks: </span>
            <span>{cleanedNotes}</span>
          </div>
        ) : null;
      })()}

      {/* Terms & Conditions (if available) */}
      {effectiveShowTerms && (
        <div className="border-t border-slate-200 pt-3 mb-6 text-[10px] text-slate-500 avoid-break">
          <div className="font-bold text-slate-700 uppercase tracking-wider text-[9px] mb-1">
            Terms &amp; Conditions:
          </div>
          {termsText ? (
            <p className="leading-relaxed whitespace-pre-line">{termsText}</p>
          ) : (
            <ol className="list-decimal list-inside space-y-0.5 leading-relaxed">
              <li>Goods once sold will not be taken back or exchanged unless approved under warranty terms.</li>
              <li>Subject to local jurisdiction only. Interest @ 18% p.a. will be charged on overdue invoices.</li>
            </ol>
          )}
        </div>
      )}

      {/* Signature Area */}
      {effectiveShowSignatures && (
        <div className="border-t-2 border-slate-300 pt-6 mt-8 grid grid-cols-3 gap-6 text-center text-[10px] avoid-break">
          <div>
            <div className="h-10"></div>
            <div className="border-t border-slate-400 font-semibold text-slate-700 pt-1">Prepared By</div>
          </div>
          <div>
            <div className="h-10"></div>
            <div className="border-t border-slate-400 font-semibold text-slate-700 pt-1">Checked By</div>
          </div>
          <div>
            <div className="h-10"></div>
            <div className="border-t border-slate-400 font-bold text-slate-900 pt-1">
              For {business?.name || 'Optical Enterprise'}
              <div className="text-[9px] font-normal text-slate-500 mt-0.5">({signatoryLabel})</div>
            </div>
          </div>
        </div>
      )}

      {/* Footer Meta */}
      <div className="mt-6 pt-2 border-t border-slate-100 flex justify-between items-center text-[9px] text-slate-400">
        <span>Generated by {business?.name || 'Optical ERP System'}</span>
        <span>Printed on: {new Date().toLocaleString('en-IN')}</span>
      </div>
    </div>
  );
};
