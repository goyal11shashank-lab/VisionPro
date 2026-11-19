/** Server-side PNG artifact. Reads stored invoice data only, never creates vouchers. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { invoiceHindiFontBase64 } from '../../assets/invoiceHindiFont.js';
import { invoiceFontBase64 } from '../../assets/invoiceFont.js';
import { db } from '../../db/index.js';
import { businesses } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { BusinessSettingsService } from '../businessSettingsService.js';
export interface InvoicePdfLine {
  description: string;
  powerText: string;
  quantity: number;
  unit: string;
  rate: number;
  amount: number;
}

export interface InvoicePdfData {
  businessName: string;
  invoiceTitle?: string;
  businessGstin?: string;
  invoiceNumber: string;
  invoiceDate: string;
  partyName: string;
  partyGstin?: string;
  lines: InvoicePdfLine[];
  subtotal: number;
  discountTotal: number;
  taxableAmount: number;
  cgstRate: number;
  cgstAmount: number;
  sgstRate: number;
  sgstAmount: number;
  igstRate: number;
  igstAmount: number;
  courierCharges: number;
  roundOff: number;
  grandTotal: number;
  outstandingAmount?: number;
  /** Set only for synthetic/demo artifacts: stamps a visible diagonal mark. */
  watermarkText?: string;
}

export function mapInvoiceLines(sourceLines: any[]): InvoicePdfLine[] {
  return sourceLines.map((l: any) => {
    const powers = (l.batches || []).map((batch: any) => {
      const parts: string[] = [];
      if (batch.sph !== undefined && batch.sph !== '') parts.push(`SPH ${batch.sph}`);
      if (batch.cyl !== undefined && batch.cyl !== '') parts.push(`CYL ${batch.cyl}`);
      if (batch.axis) parts.push(`AXIS ${batch.axis}`);
      if (batch.add) parts.push(`ADD ${batch.add}`);
      if (batch.side && batch.side !== 'NONE') parts.push(batch.side);
      return `${parts.join(', ')} : ${batch.quantity} ${l.unit || 'PRS'}`;
    });
    const quantity = Number(l.quantity ?? 0);
    const rate = Number(l.rate ?? 0);
    return {
      description: l.uniqueItemName || l.uniqueItem?.name || 'Optical Item',
      powerText: powers.join(' | '),
      quantity,
      unit: l.unit || 'PRS',
      rate,
      amount: Number(l.lineTotal ?? 0),
    };
  });

}

export async function loadInvoiceDataForInvoice(
  businessId: string,
  invoiceId: string
): Promise<{ data: InvoicePdfData; fileName: string }> {
  // Dynamic import avoids a module cycle: salesService -> whatsappService -> here.
  const { SalesService } = await import('../salesService.js');
  const inv: any = await SalesService.getSalesInvoiceById(businessId, invoiceId);

  const [biz] = await db
    .select({ name: businesses.name, tradeName: businesses.tradeName, gstin: businesses.gstin })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);

  if (inv.status === 'CANCELLED') throw new Error('Cancelled invoices cannot be sent as active invoices.');
  const lines = mapInvoiceLines(inv.lines || []);

  const config = await BusinessSettingsService.getSettings(businessId);
  const data: InvoicePdfData = {
    invoiceTitle: config.settings.print.invoiceTitle,
    watermarkText: inv.status === 'POSTED' ? undefined : 'DRAFT',
    businessName: biz?.tradeName || biz?.name || 'Optical ERP',
    businessGstin: biz?.gstin || undefined,
    invoiceNumber: inv.invoiceNumber,
    invoiceDate: new Date(inv.invoiceDate).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }),
    partyName: inv.partyName,
    partyGstin: inv.partyGstin || undefined,
    lines,
    subtotal: Number(inv.subtotal),
    discountTotal: Number(inv.discountTotal),
    taxableAmount: Number(inv.taxableAmount),
    cgstRate: Number(inv.cgstRate),
    cgstAmount: Number(inv.cgstAmount),
    sgstRate: Number(inv.sgstRate),
    sgstAmount: Number(inv.sgstAmount),
    igstRate: Number(inv.igstRate),
    igstAmount: Number(inv.igstAmount),
    courierCharges: Number(inv.courierCharges),
    roundOff: Number(inv.roundOff),
    grandTotal: Number(inv.grandTotal),
    outstandingAmount: typeof inv.outstandingAmount === 'number' ? inv.outstandingAmount : undefined,
  };

  const safeNumber = String(inv.invoiceNumber || invoiceId).replace(/[^\w-]+/g, '_');
  return { data, fileName: safeNumber };
}

export async function buildInvoiceImageForInvoice(
  businessId: string,
  invoiceId: string
): Promise<{ buffer: Buffer; fileName: string }> {
  const { data, fileName } = await loadInvoiceDataForInvoice(businessId, invoiceId);
  const buffer = await buildInvoiceImageBuffer(data);
  return { buffer, fileName: `${fileName}.png` };
}

const xmlEscape = (s: string): string =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Simple fixed-width wrapper for SVG text (approx. 5.6px per 11px char). */
function wrapSvgText(text: string, maxChars: number): string[] {
  const words = String(text || '').split(/\s+/).filter(Boolean).flatMap(w => w.match(new RegExp(`.{1,${maxChars}}`, 'gu')) || []);
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    const next = current ? `${current} ${w}` : w;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = w;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

/**
 * Pure builder: invoice data in, invoice SVG out. Shared by the PNG builder
 * and directly testable without any native module.
 */
export function buildInvoiceImageSvg(data: InvoicePdfData): string {
  const W = 900;
  const margin = 36;
  const lineH = 20;
  const rows: string[] = [];
  let y = 0;

  const esc = xmlEscape;
  const inrText = (n: number): string =>
    `Rs. ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Pre-layout the line items so the canvas height fits the content.
  const laidOutLines = data.lines.map((l) => ({
    ...l,
    descLines: wrapSvgText(l.description, 34),
    powerLines: wrapSvgText(l.powerText || '-', 26),
  }));
  const lineRowsHeight = laidOutLines.reduce(
    (h, l) => h + Math.max(l.descLines.length, l.powerLines.length, 1) * lineH + 10,
    0
  );

  const totalsRows: Array<[string, number]> = [
    ['Subtotal', data.subtotal],
    ['Discount', -Math.abs(data.discountTotal)],
    ['Taxable Amount', data.taxableAmount],
  ];
  if (data.igstAmount > 0) {
    totalsRows.push([`IGST (${data.igstRate}%)`, data.igstAmount]);
  } else {
    if (data.cgstAmount > 0) totalsRows.push([`CGST (${data.cgstRate}%)`, data.cgstAmount]);
    if (data.sgstAmount > 0) totalsRows.push([`SGST (${data.sgstRate}%)`, data.sgstAmount]);
  }
  if (data.courierCharges > 0) totalsRows.push(['Courier Charges', data.courierCharges]);
  if (data.roundOff !== 0) totalsRows.push(['Round Off', data.roundOff]);

  const H =
    150 + // header block
    60 + // bill-to
    34 + // table header
    lineRowsHeight +
    totalsRows.length * 24 +
    70 + // grand total + balance
    40; // footer

  if (H > 16000) throw new Error('Invoice image is too tall. Split-image support is required, no message sent.');
  y = margin + 26;
  rows.push(
    `<text x="${margin}" y="${y}" font-size="24" font-weight="bold" fill="#0f172a">${esc(data.businessName || 'Optical ERP')}</text>`,
    `<text x="${W - margin}" y="${y}" font-size="16" font-weight="bold" text-anchor="end" fill="#0f172a">${esc(data.invoiceTitle || 'INVOICE')}</text>`
  );
  y += 24;
  if (data.businessGstin) {
    rows.push(`<text x="${margin}" y="${y}" font-size="15" fill="#475569">GSTIN: ${esc(data.businessGstin)}</text>`);
  }
  rows.push(`<text x="${W - margin}" y="${y}" font-size="15" text-anchor="end" fill="#475569">Invoice No: ${esc(data.invoiceNumber)}</text>`);
  y += 20;
  rows.push(`<text x="${W - margin}" y="${y}" font-size="15" text-anchor="end" fill="#475569">Date: ${esc(data.invoiceDate)}</text>`);
  y += 14;
  rows.push(`<line x1="${margin}" y1="${y}" x2="${W - margin}" y2="${y}" stroke="#cbd5e1"/>`);
  y += 24;
  rows.push(
    `<text x="${margin}" y="${y}" font-size="15" font-weight="bold" fill="#0f172a">Bill To:</text>`,
    `<text x="${margin + 70}" y="${y}" font-size="15" fill="#0f172a">${esc(data.partyName)}</text>`
  );
  if (data.partyGstin) {
    y += 20;
    rows.push(`<text x="${margin + 70}" y="${y}" font-size="13" fill="#475569">GSTIN: ${esc(data.partyGstin)}</text>`);
  }
  y += 26;

  // Table header
  const colX = { num: margin, item: margin + 34, power: margin + 330, qty: margin + 560, rate: margin + 660, amount: W - margin };
  rows.push(`<rect x="${margin}" y="${y - 15}" width="${W - 2 * margin}" height="26" fill="#f1f5f9"/>`);
  rows.push(
    `<text x="${colX.num}" y="${y}" font-size="13" font-weight="bold" fill="#475569">#</text>`,
    `<text x="${colX.item}" y="${y}" font-size="13" font-weight="bold" fill="#475569">Item</text>`,
    `<text x="${colX.power}" y="${y}" font-size="13" font-weight="bold" fill="#475569">Power</text>`,
    `<text x="${colX.qty}" y="${y}" font-size="13" font-weight="bold" text-anchor="end" fill="#475569">Qty</text>`,
    `<text x="${colX.rate}" y="${y}" font-size="13" font-weight="bold" text-anchor="end" fill="#475569">Rate</text>`,
    `<text x="${colX.amount}" y="${y}" font-size="13" font-weight="bold" text-anchor="end" fill="#475569">Amount</text>`
  );
  y += 22;

  laidOutLines.forEach((l, i) => {
    const rowLines = Math.max(l.descLines.length, l.powerLines.length, 1);
    const rowTop = y;
    rows.push(`<text x="${colX.num}" y="${y}" font-size="13" fill="#0f172a">${i + 1}</text>`);
    l.descLines.forEach((t, k) => {
      rows.push(`<text x="${colX.item}" y="${rowTop + k * lineH}" font-size="13" fill="#0f172a">${esc(t)}</text>`);
    });
    l.powerLines.forEach((t, k) => {
      rows.push(`<text x="${colX.power}" y="${rowTop + k * lineH}" font-size="13" fill="#334155">${esc(t)}</text>`);
    });
    rows.push(
      `<text x="${colX.qty}" y="${rowTop}" font-size="13" text-anchor="end" fill="#0f172a">${l.quantity} ${esc(l.unit)}</text>`,
      `<text x="${colX.rate}" y="${rowTop}" font-size="13" text-anchor="end" fill="#0f172a">${inrText(l.rate)}</text>`,
      `<text x="${colX.amount}" y="${rowTop}" font-size="13" text-anchor="end" fill="#0f172a">${inrText(l.amount)}</text>`
    );
    y += rowLines * lineH + 10;
    rows.push(`<line x1="${margin}" y1="${y - 6}" x2="${W - margin}" y2="${y - 6}" stroke="#e2e8f0"/>`);
  });

  y += 12;
  const totalsX = W - margin - 330;
  for (const [label, value] of totalsRows) {
    rows.push(
      `<text x="${totalsX}" y="${y}" font-size="14" fill="#475569">${esc(label)}</text>`,
      `<text x="${W - margin}" y="${y}" font-size="14" text-anchor="end" fill="#0f172a">${inrText(value)}</text>`
    );
    y += 24;
  }
  rows.push(
    `<text x="${totalsX}" y="${y + 4}" font-size="19" font-weight="bold" fill="#0f172a">Grand Total</text>`,
    `<text x="${W - margin}" y="${y + 4}" font-size="19" font-weight="bold" text-anchor="end" fill="#0f172a">${inrText(data.grandTotal)}</text>`
  );
  y += 32;
  if (typeof data.outstandingAmount === 'number' && data.outstandingAmount > 0) {
    rows.push(`<text x="${totalsX}" y="${y}" font-size="13" fill="#475569">Balance Due: ${inrText(data.outstandingAmount)}</text>`);
    y += 24;
  }
  rows.push(`<text x="${margin}" y="${H - 14}" font-size="11" fill="#94a3b8">This is a computer-generated invoice.</text>`);

  const watermark = data.watermarkText
    ? `<text x="${W / 2}" y="${H / 2}" font-size="52" font-weight="bold" fill="rgba(200,30,30,0.55)" text-anchor="middle" transform="rotate(-30 ${W / 2} ${H / 2})">${esc(data.watermarkText)}</text>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="DejaVu Sans, Noto Sans Devanagari"><rect width="${W}" height="${H}" fill="white"/>${rows.join('')}${watermark}</svg>`;
}

/**
 * Invoice data in, PNG bytes out. Rasterizes the SVG layout with resvg.
 *
 * Rendering dependency: @resvg/resvg-js ships a prebuilt native binary per
 * platform and renders text using system fonts (DejaVu Sans preferred). If
 * the host has no usable fonts or the native module is unavailable, this
 * throws and dispatch fails closed. No text-only success is recorded.
 */
let fontPaths: Promise<string[]> | null = null;
async function prepareInvoiceFonts(): Promise<string[]> {
  if (!fontPaths) fontPaths = (async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'erp-invoice-fonts-'));
    const files = [path.join(directory, 'latin.ttf'), path.join(directory, 'devanagari.ttf')];
    await Promise.all([invoiceFontBase64, invoiceHindiFontBase64].map((font, i) => fs.writeFile(files[i], Buffer.from(font, 'base64'), { mode: 0o600 })));
    return files;
  })();
  return fontPaths;
}
export async function buildInvoiceImageBuffer(data: InvoicePdfData): Promise<Buffer> {
  const { Resvg } = await import('@resvg/resvg-js');
  const svg = buildInvoiceImageSvg(data);
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: 900 },
    font: { loadSystemFonts: false, fontFiles: await prepareInvoiceFonts(), defaultFontFamily: 'DejaVu Sans' },
    background: 'white',
  });
  return Buffer.from(resvg.render().asPng());
}
