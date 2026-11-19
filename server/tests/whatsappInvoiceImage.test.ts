import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { mapInvoiceLines, buildInvoiceImageBuffer, buildInvoiceImageSvg, type InvoicePdfData } from '../services/whatsapp/invoiceImageService.js';

const lines = mapInvoiceLines([{uniqueItemName:'CR & Blue Cut <Sample>', quantity:'3', unit:'PRS', rate:'200', lineTotal:'550', batches:[{sph:'-1.00',cyl:'-0.50',axis:90,side:'R',quantity:1},{sph:'+2.50',cyl:'0.00',side:'L',quantity:2}]}]);
assert.equal(lines.length,1);
assert.equal(lines[0].amount,550,'Use stored discounted line total, never quantity times rate');
assert.ok(lines[0].powerText.includes('-1.00'));
assert.ok(lines[0].powerText.includes('+2.50'));
assert.ok(lines[0].powerText.includes('2 PRS'));
const fixture: InvoicePdfData = {
  invoiceTitle:'INVOICE', businessName:'SAMPLE OPTICS', businessGstin:'SAMPLE ONLY', invoiceNumber:'TEST-NOT-A-SALE',invoiceDate:'20/11/2026',partyName:'TEST RECIPIENT - NOT A CUSTOMER',
  lines,subtotal:600,discountTotal:50,taxableAmount:550,cgstRate:0,cgstAmount:0,sgstRate:0,sgstAmount:0,igstRate:0,igstAmount:0,courierCharges:0,roundOff:0,grandTotal:550,outstandingAmount:550,watermarkText:'SAMPLE - NOT A SALE',
};
const svg=buildInvoiceImageSvg(fixture);
assert.ok(svg.includes('&amp; Blue Cut &lt;Sample&gt;'));
assert.ok(svg.includes('Rs. 550.00'));
assert.ok(!svg.includes('CGST ('));
const png=await buildInvoiceImageBuffer(fixture);
assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
await fs.writeFile('/downloads/erp-whatsapp-image-synthetic.png',png);
assert.throws(()=>buildInvoiceImageSvg({...fixture,lines:Array(600).fill(lines[0])}),/too tall/);
console.log('Invoice image tests passed: both batches, stored discounted totals, XML escaping, 0% GST, valid PNG, oversize fail-closed. Synthetic only, no DB or network.');
