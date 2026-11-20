import { PoolClient } from 'pg';
import { PaymentService } from './paymentService.js';

export type SettlementMode = 'CREDIT' | 'CASH' | 'BANK';

/** Marker stored in payments.notes so a voucher's own auto-created receipt/payment can be found again. */
export const AUTO_SETTLEMENT_MARK = '[AUTO-SETTLEMENT]';

export function normalizeSettlementMode(v: unknown): SettlementMode {
  const m = String(v ?? '').trim().toUpperCase();
  if (m === 'CASH' || m === 'BANK') return m;
  return 'CREDIT';
}

/**
 * Creates and posts a receipt (sales) or payment (purchase) for the full invoice total, allocated to that
 * invoice, INSIDE the caller's transaction. If anything fails the caller's invoice is rolled back too.
 * Idempotent per invoice: an active auto-settlement for the invoice is never duplicated.
 */
export async function settleInvoiceInTx(
  client: PoolClient,
  p: {
    businessId: string;
    kind: 'SALES' | 'PURCHASE';
    invoiceId: string;
    partyId: string;
    invoiceNumber: string;
    amount: number;
    mode: SettlementMode;
    date?: string | Date;
    userId?: string;
  }
): Promise<{ paymentId: string } | null> {
  if (p.mode === 'CREDIT') return null;
  const amount = Math.round(p.amount * 100) / 100;
  if (!(amount > 0)) return null;
  const existing = await findAutoSettlements(client, p.businessId, p.invoiceId);
  if (existing.length > 0) return { paymentId: existing[0].id };
  const docType = p.kind === 'SALES' ? 'SALES_INVOICE' : 'PURCHASE_INVOICE';
  const res: any = await PaymentService.createPayment(
    p.businessId,
    {
      partyId: p.partyId,
      paymentType: p.kind === 'SALES' ? 'RECEIPT' : 'PAYMENT',
      paymentMode: p.mode,
      amount,
      paymentDate: p.date,
      notes: `${AUTO_SETTLEMENT_MARK} ${p.mode} settlement of ${p.invoiceNumber}`,
      allocations: [{ documentType: docType, documentId: p.invoiceId, allocatedAmount: amount }],
      autoPost: true,
    },
    p.userId,
    client
  );
  return { paymentId: res.id };
}

export async function findAutoSettlements(client: PoolClient, businessId: string, invoiceId: string) {
  const r = await client.query(
    `SELECT DISTINCT p.id, p.payment_mode
       FROM payments p
       JOIN payment_allocations pa ON pa.payment_id = p.id
      WHERE p.business_id = $1 AND pa.document_id = $2 AND pa.status = 'ACTIVE'
        AND p.status <> 'CANCELLED' AND p.notes LIKE $3`,
    [businessId, invoiceId, `${AUTO_SETTLEMENT_MARK}%`]
  );
  return r.rows as { id: string; payment_mode: string }[];
}

/** Cancels this invoice's own auto-created settlement(s). Returns the mode they had (for re-settling an edit). */
export async function reverseAutoSettlementsInTx(
  client: PoolClient,
  businessId: string,
  invoiceId: string,
  reason: string,
  userId?: string
): Promise<SettlementMode | null> {
  const rows = await findAutoSettlements(client, businessId, invoiceId);
  let mode: SettlementMode | null = null;
  for (const r of rows) {
    await PaymentService.cancelPayment(businessId, r.id, reason, userId, client);
    mode = normalizeSettlementMode(r.payment_mode);
  }
  return mode;
}
