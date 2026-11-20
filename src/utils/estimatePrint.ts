// Output-only half-sheet invoice layout, based on the owner's QuickBill style.
// All amounts come from the saved voucher. This module never recalculates tax.
import { numberToIndianWords } from './numberToWords.js';
import { cleanNarrationNotes } from './narrationHelper.js';

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]!));
const num = (v: unknown) => Number.isFinite(Number(v)) ? Number(v) : 0;
const money = (v: unknown) => num(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const NAVY = '#1e3a5f';
export function wrapEstimateText(text: unknown, width: number): string[] {
  const result: string[] = []; let current = '';
  for (let word of String(text ?? '').trim().split(/\s+/).filter(Boolean)) {
    while (word.length > width) {
      if (current) { result.push(current); current = ''; }
      result.push(word.slice(0, width)); word = word.slice(width);
    }
    if (!current) current = word;
    else if ((current + ' ' + word).length <= width) current += ' ' + word;
    else { result.push(current); current = word; }
  }
  if (current) result.push(current);
  return result.length ? result : [''];
}
interface Row { seq: string; text: string[]; quantity?: number; unit?: string; rate?: number; amount?: number; }
interface Summary { label: string; amount: number; total?: boolean; }
export function estimateSummary(voucher: any): Summary[] {
  const rows: Summary[] = [];
  const add = (label: string, amount: unknown) => { if (num(amount) !== 0) rows.push({ label, amount: num(amount) }); };
  add('Items', voucher.subtotal);
  add('Less discount', -Math.abs(num(voucher.discountTotal ?? voucher.discount)));
  add('Courier charges', voucher.courierCharges);
  add('CGST', voucher.cgstAmount); add('SGST', voucher.sgstAmount); add('IGST', voucher.igstAmount);
  add('Round off', voucher.roundOff);
  rows.push({ label: 'Total', amount: num(voucher.grandTotal ?? voucher.totalAmount ?? voucher.amount), total: true });
  // Display a supplied historical snapshot only. Never substitute today's party balance.
  const walkIn = /^(cash|cash sale|walk[ -]?in)$/i.test(String(voucher.partyName || voucher.party?.name || '').trim());
  if (voucher.printBalanceSnapshot?.previousBalance != null && !walkIn) {
    rows.push({ label: 'Previous Balance', amount: num(voucher.printBalanceSnapshot.previousBalance) });
    rows.push({ label: 'Current Balance', amount: num(voucher.printBalanceSnapshot.balanceAfterBill) });
  }
  return rows;
}
export function renderEstimatePages(voucher: any, options: { orientation?: 'portrait' | 'landscape'; showBatches?: boolean; showHsn?: boolean; showDiscount?: boolean; showSignatory?: boolean; showNarration?: boolean; signatoryLabel?: string } = {}): string[] {
  const landscape = options.orientation === 'landscape';
  const W = landscape ? 1050 : 742, H = landscape ? 742 : 1050;
  const start = landscape ? 250 : 278, bottom = H - 60;
  const descriptionWidth = landscape ? 57 : 32;
  const qtyX = landscape ? 690 : 450, rateX = landscape ? 805 : 550, amountX = W - 30;
  const rows: Row[] = [];
  (voucher.lines || []).forEach((l: any, i: number) => {
    let description = String(l.uniqueItemName || l.uniqueItem?.name || l.itemName || l.description || 'Item');
    if (options.showBatches === true) for (const b of (l.batches || [])) {
      const p = b.batch || b;
      description += ` | SPH ${p.sph ?? b.sph ?? '0.00'} CYL ${p.cyl ?? b.cyl ?? '0.00'}`;
      if (num(p.axis ?? b.axis)) description += ` AX ${p.axis ?? b.axis}`;
      if (num(p.add ?? b.add)) description += ` ADD ${p.add ?? b.add}`;
      if ((p.side || b.side) && (p.side || b.side) !== 'NONE') description += ` ${p.side || b.side}`;
      description += ` (${b.quantity ?? 0} ${l.unit || l.uniqueItem?.unit || 'PRS'})`;
    }
    const hsn = l.hsnCode || l.hsnSac || l.uniqueItem?.hsnCode || l.uniqueItem?.hsnSac;
    if (options.showHsn !== false && hsn) description += ` | HSN ${hsn}`;
    if (options.showDiscount !== false && num(l.discountAmount)) description += ` | Discount Rs ${money(l.discountAmount)}`;
    const text = wrapEstimateText(description, descriptionWidth);
    const maxLines = Math.floor((bottom - start - 12) / 18);
    for (let offset = 0; offset < text.length; offset += maxLines) rows.push({
      seq: offset ? `${i + 1}c` : String(i + 1), text: text.slice(offset, offset + maxLines),
      ...(offset ? {} : { quantity: num(l.quantity), unit: l.unit || l.uniqueItem?.unit || 'PRS', rate: num(l.rate ?? l.unitPrice), amount: num(l.lineTotal ?? l.totalAmount) }),
    });
  });
  const summary = estimateSummary(voucher);
  const note = options.showNarration === false ? '' : cleanNarrationNotes(voucher.notes || '');
  const noteLines = note ? wrapEstimateText('Note: ' + note, descriptionWidth) : [];
  const maxNoteLines = Math.floor((bottom - start - 12) / 18);
  for (let offset = 0; offset < noteLines.length; offset += maxNoteLines) rows.push({ seq: '', text: noteLines.slice(offset, offset + maxNoteLines) });
  const footerHeight = summary.length * 21 + 110;
  const pages: Row[][] = [[]]; let y = start;
  for (const row of rows) {
    const height = Math.max(1, row.text.length) * 18 + 12;
    if (y + height > bottom && pages.at(-1)!.length) { pages.push([]); y = start; }
    pages.at(-1)!.push(row); y += height;
  }
  // Reserve the complete footer, moving as many rows as needed, not just one.
  const heightOf = (r: Row) => Math.max(1, r.text.length) * 18 + 12;
  let last = pages.at(-1)!;
  if (start + last.reduce((a, r) => a + heightOf(r), 0) + footerHeight > bottom) {
    const finalRows: Row[] = []; let room = bottom - start - footerHeight;
    while (last.length && heightOf(last.at(-1)!) <= room) {
      const row = last.pop()!; finalRows.unshift(row); room -= heightOf(row);
    }
    pages.push(finalRows);
    if (!last.length && pages.length > 1) pages.splice(pages.length - 2, 1);
  }
  const storedTax = num(voucher.cgstAmount) + num(voucher.sgstAmount) + num(voucher.igstAmount);
  const title = storedTax > 0 ? 'TAX INVOICE' : 'ESTIMATE';
  const invoiceNo = voucher.invoiceNumber || voucher.voucherNumber || '';
  const rawDate = String(voucher.invoiceDate || voucher.date || '');
  const parsedDate = new Date(rawDate);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate
    : Number.isNaN(parsedDate.getTime()) ? ''
    : new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(parsedDate);
  const party = voucher.partyName || voucher.party?.name || 'Cash';
  const city = voucher.party?.city || voucher.partyCity || '';
  return pages.map((page, index) => {
    const out: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Arial,Helvetica,sans-serif" style="print-color-adjust:exact;-webkit-print-color-adjust:exact"><rect width="${W}" height="${H}" fill="white"/>`];
    const text = (x: number, y: number, content: unknown, size = 14, bold = false, anchor = 'start', color = '#161616') => out.push(`<text x="${x}" y="${y}" font-size="${size}" ${bold ? 'font-weight="bold"' : ''} text-anchor="${anchor}" fill="${color}">${esc(content)}</text>`);
    text(28, 43, title, 25, true, 'start', NAVY); text(28, 73, 'Optical Shop', 17, true); text(28, 93, 'Delhi', 12, false, 'start', '#6b7280');
    out.push(`<line x1="18" y1="115" x2="${W - 18}" y2="115" stroke="#c9cfd6"/>`);
    text(28, 137, 'Invoice No.', 10); text(28, 158, invoiceNo, 15, true);
    text(landscape ? 425 : 270, 137, 'Dated', 10); text(landscape ? 425 : 270, 158, date, 14);
    text(W - 30, 137, `Page ${index + 1} of ${pages.length}`, 11, false, 'end');
    const partyY = landscape ? 181 : 198;
    text(28, partyY, party, 17, true); if (city) text(28, partyY + 19, city, 11);
    if (voucher.status === 'CANCELLED' || voucher.status === 'VOID') text(W - 30, 175, 'CANCELLED', 18, true, 'end', '#b91c1c');
    const tableTop = start - 40;
    out.push(`<rect x="18" y="${tableTop}" width="${W - 36}" height="25" fill="${NAVY}"/>`);
    text(25, tableTop + 17, 'Sl', 12, true, 'start', 'white'); text(65, tableTop + 17, 'Description of Goods', 12, true, 'start', 'white');
    text(qtyX, tableTop + 17, 'Quantity', 12, true, 'end', 'white'); text(rateX, tableTop + 17, 'Rate', 12, true, 'end', 'white'); text(amountX, tableTop + 17, 'Amount', 12, true, 'end', 'white');
    let rowY = start + 10;
    for (const row of page) {
      text(25, rowY, row.seq, 13);
      row.text.forEach((part, i) => text(65, rowY + i * 18, part, 14));
      if (row.quantity != null) {
        text(qtyX, rowY, `${row.quantity} ${row.unit}`, 13, false, 'end'); text(rateX, rowY, money(row.rate), 13, false, 'end'); text(amountX, rowY, money(row.amount), 13, false, 'end');
      }
      rowY += heightOf(row);
      out.push(`<line x1="25" y1="${rowY - 9}" x2="${W - 30}" y2="${rowY - 9}" stroke="#e8ebee"/>`);
    }
    if (index === pages.length - 1) {
      rowY += 20;
      for (const row of summary) {
        if (row.total) { out.push(`<line x1="${W - 345}" y1="${rowY - 18}" x2="${W - 30}" y2="${rowY - 18}" stroke="${NAVY}" stroke-width="2"/>`); rowY += 5; }
        text(W - 165, rowY, row.label, row.total ? 19 : 13, !!row.total, 'end', row.total ? NAVY : '#161616');
        text(W - 30, rowY, money(row.amount), row.total ? 19 : 13, !!row.total, 'end', row.total ? NAVY : '#161616'); rowY += 21;
      }
      text(28, rowY + 22, 'Amount chargeable (in words)', 10);
      wrapEstimateText(numberToIndianWords(num(voucher.grandTotal ?? voucher.totalAmount ?? voucher.amount)), landscape ? 100 : 63).forEach((line, i) => text(28, rowY + 40 + i * 15, line, 12, true));
      if (options.showSignatory !== false) { text(W - 30, H - 45, 'for Optical Shop', 13, true, 'end', NAVY); text(W - 30, H - 25, options.signatoryLabel || 'Authorised Signatory', 11, false, 'end'); }
    } else text(W - 30, H - 28, 'Continued on next half sheet', 11, false, 'end');
    text(28, H - 25, `${invoiceNo}  page ${index + 1}/${pages.length}`, 10, false, 'start', '#6b7280');
    out.push('</svg>'); return out.join('');
  });
}
