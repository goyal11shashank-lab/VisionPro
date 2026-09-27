import { PoolClient } from 'pg';
import { db, pool } from '../db/index.js';
import {
  payments,
  paymentAllocations,
  parties,
  salesInvoices,
  purchaseInvoices,
  customerLedgers,
  supplierLedgers,
} from '../db/schema.js';
import { eq, and, sql, desc } from 'drizzle-orm';
import { AuditService } from './auditService.js';
import { DocumentSequenceService, DocumentType } from './documentSequenceService.js';

export function round2(num: number): number {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

export interface AllocationItemInput {
  documentType: 'SALES_INVOICE' | 'PURCHASE_INVOICE';
  documentId: string;
  allocatedAmount: number;
  notes?: string;
}

export interface CreatePaymentDto {
  partyId: string;
  paymentType: 'RECEIPT' | 'PAYMENT';
  paymentMode: 'CASH' | 'BANK' | 'UPI' | 'CHEQUE' | 'OTHER';
  amount: number;
  paymentNumber?: string;
  paymentDate?: string | Date;
  referenceNumber?: string;
  referenceDate?: string | Date;
  bankName?: string;
  notes?: string;
  allocations?: AllocationItemInput[];
  autoPost?: boolean;
  idempotencyKey?: string;
}

export class PaymentService {
  /**
   * Generates a safe, sequential, collision-free payment number
   */
  static async generatePaymentNumber(
    businessId: string,
    paymentType: 'RECEIPT' | 'PAYMENT',
    client?: PoolClient,
    options?: any
  ): Promise<string> {
    const docType: DocumentType =
      paymentType === 'RECEIPT' ? 'CUSTOMER_RECEIPT' : 'SUPPLIER_PAYMENT';
    return await DocumentSequenceService.getNextVoucherNumber(
      client || pool,
      businessId,
      docType,
      options
    );
  }

  /**
   * Validates party compatibility for the requested payment type
   */
  private static validatePartyCompatibility(party: any, paymentType: 'RECEIPT' | 'PAYMENT') {
    if (!party) throw new Error('Party record not found');
    if (party.status !== 'ACTIVE') throw new Error(`Party "${party.name}" is not active`);

    const type = (party.party_type || party.partyType || '').toUpperCase();
    if (paymentType === 'RECEIPT') {
      if (type !== 'CUSTOMER' && type !== 'BOTH') {
        throw new Error(`Party "${party.name}" is a ${type} only, not configured as a customer for receipts`);
      }
    } else if (paymentType === 'PAYMENT') {
      if (type !== 'SUPPLIER' && type !== 'BOTH') {
        throw new Error(`Party "${party.name}" is a ${type} only, not configured as a supplier for payments`);
      }
    }
  }

  /**
   * Creates a new Payment voucher (Receipt or Supplier Payment)
   */
  static async createPayment(
    businessId: string,
    data: CreatePaymentDto,
    userId?: string
  ) {
    if (!data.partyId) throw new Error('Party is required');
    if (!data.paymentType || !['RECEIPT', 'PAYMENT'].includes(data.paymentType)) {
      throw new Error('Valid paymentType (RECEIPT or PAYMENT) is required');
    }
    if (!data.paymentMode) throw new Error('Payment mode is required');
    
    const amount = round2(Number(data.amount));
    if (isNaN(amount) || amount <= 0) {
      throw new Error('Payment amount must be greater than zero');
    }

    if (data.idempotencyKey) {
      const resourceType = data.paymentType === 'RECEIPT' ? 'CUSTOMER_RECEIPT' : 'SUPPLIER_PAYMENT';
      const existingId = await DocumentSequenceService.checkIdempotency(pool, businessId, resourceType, data.idempotencyKey);
      if (existingId) {
        return await this.getPaymentById(businessId, existingId);
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Validate party
      const partyRes = await client.query(
        `SELECT id, name, party_type, status, business_id 
         FROM parties 
         WHERE business_id = $1 AND id = $2 
         FOR UPDATE`,
        [businessId, data.partyId]
      );
      if (partyRes.rows.length === 0) {
        throw new Error('Party not found or does not belong to this business');
      }
      this.validatePartyCompatibility(partyRes.rows[0], data.paymentType);

      // 2. Validate allocations if provided
      const rawAllocations = data.allocations || [];
      let totalAllocated = 0;

      for (const alloc of rawAllocations) {
        const allocAmt = round2(Number(alloc.allocatedAmount));
        if (isNaN(allocAmt) || allocAmt <= 0) {
          throw new Error('Allocated amount must be greater than zero');
        }
        totalAllocated = round2(totalAllocated + allocAmt);

        if (data.paymentType === 'RECEIPT') {
          if (alloc.documentType !== 'SALES_INVOICE') {
            throw new Error('Customer receipts can only be allocated against SALES_INVOICE');
          }
          const invRes = await client.query(
            `SELECT id, invoice_number, party_id, grand_total, status, payment_status 
             FROM sales_invoices 
             WHERE business_id = $1 AND id = $2 
             FOR UPDATE`,
            [businessId, alloc.documentId]
          );
          if (invRes.rows.length === 0) {
            throw new Error(`Sales invoice ${alloc.documentId} not found`);
          }
          const inv = invRes.rows[0];
          if (inv.party_id !== data.partyId) {
            throw new Error(`Sales invoice ${inv.invoice_number} does not belong to this party`);
          }
          if (inv.status !== 'POSTED') {
            throw new Error(`Cannot allocate to invoice ${inv.invoice_number} with status ${inv.status}. Invoice must be POSTED.`);
          }

          // Calculate current outstanding (subtracting paid allocations and active returns)
          const curPaidRes = await client.query(
            `SELECT COALESCE(SUM(allocated_amount), 0) as paid 
             FROM payment_allocations 
             WHERE business_id = $1 AND document_id = $2 AND status = 'ACTIVE'`,
            [businessId, inv.id]
          );
          const currentPaid = parseFloat(curPaidRes.rows[0]?.paid || '0');
          const retRes = await client.query(
            `SELECT COALESCE(SUM(grand_total), 0) as returned 
             FROM sales_returns 
             WHERE business_id = $1 AND sales_invoice_id = $2 AND status = 'POSTED'`,
            [businessId, inv.id]
          );
          const currentReturned = parseFloat(retRes.rows[0]?.returned || '0');
          const grandTotal = parseFloat(inv.grand_total);
          const outstanding = round2(Math.max(0, grandTotal - currentPaid - currentReturned));

          if (allocAmt > round2(outstanding + 0.001)) {
            throw new Error(`Allocation of ${allocAmt.toFixed(2)} exceeds invoice ${inv.invoice_number} outstanding balance of ${outstanding.toFixed(2)}`);
          }
        } else {
          // PAYMENT -> PURCHASE_INVOICE
          if (alloc.documentType !== 'PURCHASE_INVOICE') {
            throw new Error('Supplier payments can only be allocated against PURCHASE_INVOICE');
          }
          const invRes = await client.query(
            `SELECT id, invoice_number, supplier_party_id, grand_total, status, payment_status 
             FROM purchase_invoices 
             WHERE business_id = $1 AND id = $2 
             FOR UPDATE`,
            [businessId, alloc.documentId]
          );
          if (invRes.rows.length === 0) {
            throw new Error(`Purchase invoice ${alloc.documentId} not found`);
          }
          const inv = invRes.rows[0];
          if (inv.supplier_party_id !== data.partyId) {
            throw new Error(`Purchase invoice ${inv.invoice_number} does not belong to this party`);
          }
          if (inv.status !== 'POSTED') {
            throw new Error(`Cannot allocate to purchase invoice ${inv.invoice_number} with status ${inv.status}. Invoice must be POSTED.`);
          }

          // Calculate current outstanding (subtracting paid allocations and active debit notes)
          const curPaidRes = await client.query(
            `SELECT COALESCE(SUM(allocated_amount), 0) as paid 
             FROM payment_allocations 
             WHERE business_id = $1 AND document_id = $2 AND status = 'ACTIVE'`,
            [businessId, inv.id]
          );
          const currentPaid = parseFloat(curPaidRes.rows[0]?.paid || '0');
          const retRes = await client.query(
            `SELECT COALESCE(SUM(grand_total), 0) as returned 
             FROM purchase_returns 
             WHERE business_id = $1 AND purchase_invoice_id = $2 AND status = 'POSTED'`,
            [businessId, inv.id]
          );
          const currentReturned = parseFloat(retRes.rows[0]?.returned || '0');
          const grandTotal = parseFloat(inv.grand_total);
          const outstanding = round2(Math.max(0, grandTotal - currentPaid - currentReturned));

          if (allocAmt > round2(outstanding + 0.001)) {
            throw new Error(`Allocation of ${allocAmt.toFixed(2)} exceeds purchase bill ${inv.invoice_number} outstanding balance of ${outstanding.toFixed(2)}`);
          }
        }
      }

      if (totalAllocated > round2(amount + 0.001)) {
        throw new Error(`Total allocated amount (${totalAllocated.toFixed(2)}) cannot exceed payment amount (${amount.toFixed(2)})`);
      }

      const unallocatedAmount = round2(amount - totalAllocated);

      // 3. Generate payment number
      const paymentDate = data.paymentDate ? new Date(data.paymentDate) : new Date();
      const paymentNumber =
        data.paymentNumber ||
        (await this.generatePaymentNumber(businessId, data.paymentType, client, {
          voucherDate: paymentDate,
        }));

      // 4. Insert Payment Master
      const payInsertRes = await client.query(
        `INSERT INTO payments (
          business_id, party_id, payment_number, payment_date,
          payment_type, payment_mode, amount, unallocated_amount,
          reference_number, reference_date, bank_name, notes,
          status, created_by, updated_by, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4,
          $5, $6, $7, $8,
          $9, $10, $11, $12,
          'DRAFT', $13, $13, NOW(), NOW()
        ) RETURNING id`,
        [
          businessId,
          data.partyId,
          paymentNumber,
          paymentDate,
          data.paymentType,
          data.paymentMode,
          amount.toFixed(2),
          unallocatedAmount.toFixed(2),
          data.referenceNumber || null,
          data.referenceDate ? new Date(data.referenceDate) : null,
          data.bankName || null,
          data.notes || null,
          userId || null,
        ]
      );

      const paymentId = payInsertRes.rows[0].id;

      // 5. Insert Allocations
      for (const alloc of rawAllocations) {
        const allocAmt = round2(Number(alloc.allocatedAmount));
        await client.query(
          `INSERT INTO payment_allocations (
            business_id, payment_id, party_id, document_type,
            document_id, allocated_amount, status, notes,
            created_by, created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4,
            $5, $6, 'ACTIVE', $7,
            $8, NOW(), NOW()
          )`,
          [
            businessId,
            paymentId,
            data.partyId,
            alloc.documentType,
            alloc.documentId,
            allocAmt.toFixed(2),
            alloc.notes || null,
            userId || null,
          ]
        );
      }

      if (data.idempotencyKey) {
        const resourceType = data.paymentType === 'RECEIPT' ? 'CUSTOMER_RECEIPT' : 'SUPPLIER_PAYMENT';
        await DocumentSequenceService.recordIdempotency(
          client,
          businessId,
          resourceType,
          data.idempotencyKey,
          paymentId
        );
      }

      await client.query('COMMIT');

      await AuditService.log({
        businessId,
        userId,
        module: 'payment',
        action: 'CREATE_PAYMENT',
        entityType: 'PAYMENT',
        entityId: paymentId,
        newValue: {
          paymentNumber,
          paymentType: data.paymentType,
          amount,
          partyId: data.partyId,
          status: 'DRAFT',
        },
      });

      // Auto-post if requested
      if (data.autoPost) {
        return await this.postPayment(businessId, paymentId, userId);
      }

      return await this.getPaymentById(businessId, paymentId);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Posts and finalizes a DRAFT Payment voucher
   */
  static async postPayment(businessId: string, paymentId: string, userId?: string) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Lock payment
      const payRes = await client.query(
        `SELECT * FROM payments 
         WHERE business_id = $1 AND id = $2 
         FOR UPDATE`,
        [businessId, paymentId]
      );

      if (payRes.rows.length === 0) {
        throw new Error('Payment voucher not found');
      }

      const payment = payRes.rows[0];
      if (payment.status !== 'DRAFT') {
        throw new Error(`Only DRAFT payments can be posted. Current status: ${payment.status}`);
      }

      const amountNum = parseFloat(payment.amount);
      const partyId = payment.party_id;
      const paymentType = payment.payment_type;

      // 2. Fetch and re-validate all active allocations for this payment
      const allocsRes = await client.query(
        `SELECT * FROM payment_allocations 
         WHERE business_id = $1 AND payment_id = $2 AND status = 'ACTIVE'`,
        [businessId, paymentId]
      );

      for (const alloc of allocsRes.rows) {
        const allocAmt = parseFloat(alloc.allocated_amount);
        if (paymentType === 'RECEIPT') {
          const invRes = await client.query(
            `SELECT id, invoice_number, grand_total, status 
             FROM sales_invoices 
             WHERE business_id = $1 AND id = $2 
             FOR UPDATE`,
            [businessId, alloc.document_id]
          );
          if (invRes.rows.length === 0) {
            throw new Error(`Sales invoice ${alloc.document_id} not found`);
          }
          const inv = invRes.rows[0];
          if (inv.status !== 'POSTED') {
            throw new Error(`Invoice ${inv.invoice_number} is not in POSTED status`);
          }

          // Calculate current paid excluding this allocation (also taking into account returns)
          const otherPaidRes = await client.query(
            `SELECT COALESCE(SUM(allocated_amount), 0) as paid 
             FROM payment_allocations 
             WHERE business_id = $1 AND document_id = $2 AND status = 'ACTIVE' AND id != $3`,
            [businessId, inv.id, alloc.id]
          );
          const otherPaid = parseFloat(otherPaidRes.rows[0]?.paid || '0');
          const retRes = await client.query(
            `SELECT COALESCE(SUM(grand_total), 0) as returned 
             FROM sales_returns 
             WHERE business_id = $1 AND sales_invoice_id = $2 AND status = 'POSTED'`,
            [businessId, inv.id]
          );
          const returnedAmt = parseFloat(retRes.rows[0]?.returned || '0');
          const grandTotal = parseFloat(inv.grand_total);
          const outstanding = round2(Math.max(0, grandTotal - otherPaid - returnedAmt));

          if (allocAmt > round2(outstanding + 0.001)) {
            throw new Error(`Allocated amount (${allocAmt.toFixed(2)}) exceeds invoice ${inv.invoice_number} outstanding of ${outstanding.toFixed(2)}`);
          }
        } else {
          // PAYMENT -> PURCHASE_INVOICE
          const invRes = await client.query(
            `SELECT id, invoice_number, grand_total, status 
             FROM purchase_invoices 
             WHERE business_id = $1 AND id = $2 
             FOR UPDATE`,
            [businessId, alloc.document_id]
          );
          if (invRes.rows.length === 0) {
            throw new Error(`Purchase invoice ${alloc.document_id} not found`);
          }
          const inv = invRes.rows[0];
          if (inv.status !== 'POSTED') {
            throw new Error(`Purchase bill ${inv.invoice_number} is not in POSTED status`);
          }

          // Calculate current paid excluding this allocation (also taking into account debit notes)
          const otherPaidRes = await client.query(
            `SELECT COALESCE(SUM(allocated_amount), 0) as paid 
             FROM payment_allocations 
             WHERE business_id = $1 AND document_id = $2 AND status = 'ACTIVE' AND id != $3`,
            [businessId, inv.id, alloc.id]
          );
          const otherPaid = parseFloat(otherPaidRes.rows[0]?.paid || '0');
          const retRes = await client.query(
            `SELECT COALESCE(SUM(grand_total), 0) as returned 
             FROM purchase_returns 
             WHERE business_id = $1 AND purchase_invoice_id = $2 AND status = 'POSTED'`,
            [businessId, inv.id]
          );
          const returnedAmt = parseFloat(retRes.rows[0]?.returned || '0');
          const grandTotal = parseFloat(inv.grand_total);
          const outstanding = round2(Math.max(0, grandTotal - otherPaid - returnedAmt));

          if (allocAmt > round2(outstanding + 0.001)) {
            throw new Error(`Allocated amount (${allocAmt.toFixed(2)}) exceeds purchase bill ${inv.invoice_number} outstanding of ${outstanding.toFixed(2)}`);
          }
        }
      }

      // 3. Update Payment Master status to POSTED
      await client.query(
        `UPDATE payments 
         SET status = 'POSTED', updated_at = NOW(), updated_by = $1 
         WHERE id = $2`,
        [userId || null, paymentId]
      );

      // 4. Update Ledgers & sync invoice payment statuses
      if (paymentType === 'RECEIPT') {
        // Lock last customer ledger
        const lastLedgerRes = await client.query(
          `SELECT balance FROM customer_ledgers 
           WHERE business_id = $1 AND party_id = $2 
           ORDER BY transaction_date DESC, created_at DESC 
           LIMIT 1 FOR UPDATE`,
          [businessId, partyId]
        );
        const prevBalance = lastLedgerRes.rows.length > 0 ? parseFloat(lastLedgerRes.rows[0].balance) : 0;
        const newBalance = round2(prevBalance - amountNum);

        await client.query(
          `INSERT INTO customer_ledgers (
            business_id, party_id, transaction_type, reference_type, reference_id,
            debit, credit, balance, transaction_date, notes, created_by, created_at
          ) VALUES (
            $1, $2, 'RECEIPT', 'PAYMENT', $3,
            '0.00', $4, $5, $6, $7, $8, NOW()
          )`,
          [
            businessId,
            partyId,
            paymentId,
            amountNum.toFixed(2),
            newBalance.toFixed(2),
            payment.payment_date,
            `Receipt ${payment.payment_number} (${payment.payment_mode})`,
            userId || null,
          ]
        );

        // Update each invoice's payment_status
        for (const alloc of allocsRes.rows) {
          await this.syncSalesInvoicePaymentStatus(client, businessId, alloc.document_id);
        }
      } else {
        // PAYMENT -> Supplier Ledger
        const lastLedgerRes = await client.query(
          `SELECT balance FROM supplier_ledgers 
           WHERE business_id = $1 AND party_id = $2 
           ORDER BY transaction_date DESC, created_at DESC 
           LIMIT 1 FOR UPDATE`,
          [businessId, partyId]
        );
        const prevBalance = lastLedgerRes.rows.length > 0 ? parseFloat(lastLedgerRes.rows[0].balance) : 0;
        const newBalance = round2(prevBalance - amountNum);

        await client.query(
          `INSERT INTO supplier_ledgers (
            business_id, party_id, transaction_type, reference_type, reference_id,
            debit, credit, balance, transaction_date, notes, created_by, created_at
          ) VALUES (
            $1, $2, 'PAYMENT', 'PAYMENT', $3,
            $4, '0.00', $5, $6, $7, $8, NOW()
          )`,
          [
            businessId,
            partyId,
            paymentId,
            amountNum.toFixed(2),
            newBalance.toFixed(2),
            payment.payment_date,
            `Payment ${payment.payment_number} (${payment.payment_mode})`,
            userId || null,
          ]
        );

        // Update each purchase invoice's payment_status
        for (const alloc of allocsRes.rows) {
          await this.syncPurchaseInvoicePaymentStatus(client, businessId, alloc.document_id);
        }
      }

      await client.query('COMMIT');

      await AuditService.log({
        businessId,
        userId,
        module: 'payment',
        action: 'POST_PAYMENT',
        entityType: 'PAYMENT',
        entityId: paymentId,
        newValue: {
          paymentNumber: payment.payment_number,
          status: 'POSTED',
          amount: amountNum,
        },
      });

      return await this.getPaymentById(businessId, paymentId);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Synchronizes payment_status on Sales Invoice (factoring in active payments and posted returns)
   */
  public static async syncSalesInvoicePaymentStatus(clientOrNull: PoolClient | null, businessId: string, invoiceId: string) {
    const executor = clientOrNull || pool;
    const invRes = await executor.query(
      `SELECT grand_total FROM sales_invoices WHERE business_id = $1 AND id = $2`,
      [businessId, invoiceId]
    );
    if (invRes.rows.length === 0) return;
    const grandTotal = parseFloat(invRes.rows[0].grand_total);

    const paidRes = await executor.query(
      `SELECT COALESCE(SUM(pa.allocated_amount), 0) as paid 
       FROM payment_allocations pa
       JOIN payments p ON p.id = pa.payment_id
       WHERE pa.business_id = $1 AND pa.document_id = $2 
         AND pa.status = 'ACTIVE' AND p.status = 'POSTED'`,
      [businessId, invoiceId]
    );
    const totalPaid = parseFloat(paidRes.rows[0]?.paid || '0');

    const retRes = await executor.query(
      `SELECT COALESCE(SUM(grand_total), 0) as returned 
       FROM sales_returns 
       WHERE business_id = $1 AND sales_invoice_id = $2 AND status = 'POSTED'`,
      [businessId, invoiceId]
    );
    const totalReturned = parseFloat(retRes.rows[0]?.returned || '0');
    const totalAdjusted = round2(totalPaid + totalReturned);

    let newStatus = 'UNPAID';
    if (totalAdjusted >= round2(grandTotal - 0.001)) {
      newStatus = 'PAID';
    } else if (totalAdjusted > 0.001) {
      newStatus = 'PARTIAL';
    }

    await executor.query(
      `UPDATE sales_invoices SET payment_status = $1, updated_at = NOW() WHERE id = $2`,
      [newStatus, invoiceId]
    );
  }

  /**
   * Synchronizes payment_status on Purchase Invoice (factoring in active payments and posted debit notes)
   */
  public static async syncPurchaseInvoicePaymentStatus(clientOrNull: PoolClient | null, businessId: string, invoiceId: string) {
    const executor = clientOrNull || pool;
    const invRes = await executor.query(
      `SELECT grand_total FROM purchase_invoices WHERE business_id = $1 AND id = $2`,
      [businessId, invoiceId]
    );
    if (invRes.rows.length === 0) return;
    const grandTotal = parseFloat(invRes.rows[0].grand_total);

    const paidRes = await executor.query(
      `SELECT COALESCE(SUM(pa.allocated_amount), 0) as paid 
       FROM payment_allocations pa
       JOIN payments p ON p.id = pa.payment_id
       WHERE pa.business_id = $1 AND pa.document_id = $2 
         AND pa.status = 'ACTIVE' AND p.status = 'POSTED'`,
      [businessId, invoiceId]
    );
    const totalPaid = parseFloat(paidRes.rows[0]?.paid || '0');

    const retRes = await executor.query(
      `SELECT COALESCE(SUM(grand_total), 0) as returned 
       FROM purchase_returns 
       WHERE business_id = $1 AND purchase_invoice_id = $2 AND status = 'POSTED'`,
      [businessId, invoiceId]
    );
    const totalReturned = parseFloat(retRes.rows[0]?.returned || '0');
    const totalAdjusted = round2(totalPaid + totalReturned);

    let newStatus = 'UNPAID';
    if (totalAdjusted >= round2(grandTotal - 0.001)) {
      newStatus = 'PAID';
    } else if (totalAdjusted > 0.001) {
      newStatus = 'PARTIAL';
    }

    await executor.query(
      `UPDATE purchase_invoices SET payment_status = $1, updated_at = NOW() WHERE id = $2`,
      [newStatus, invoiceId]
    );
  }

  /**
   * Allocates an existing payment to invoices (either during DRAFT or POSTED state)
   */
  static async allocatePayment(
    businessId: string,
    paymentId: string,
    allocations: AllocationItemInput[],
    userId?: string
  ) {
    if (!allocations || allocations.length === 0) {
      throw new Error('At least one allocation item is required');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Lock payment
      const payRes = await client.query(
        `SELECT * FROM payments 
         WHERE business_id = $1 AND id = $2 
         FOR UPDATE`,
        [businessId, paymentId]
      );
      if (payRes.rows.length === 0) {
        throw new Error('Payment not found');
      }
      const payment = payRes.rows[0];

      if (payment.status === 'CANCELLED') {
        throw new Error('Cannot allocate against a CANCELLED payment voucher');
      }

      const totalAmount = parseFloat(payment.amount);

      // 2. Fetch existing active allocations
      const curAllocsRes = await client.query(
        `SELECT COALESCE(SUM(allocated_amount), 0) as total_alloc 
         FROM payment_allocations 
         WHERE business_id = $1 AND payment_id = $2 AND status = 'ACTIVE'`,
        [businessId, paymentId]
      );
      const existingAllocated = parseFloat(curAllocsRes.rows[0]?.total_alloc || '0');
      const remainingUnallocated = round2(totalAmount - existingAllocated);

      let newRequestedAllocation = 0;
      for (const a of allocations) {
        const amt = round2(Number(a.allocatedAmount));
        if (isNaN(amt) || amt <= 0) {
          throw new Error('Allocated amount must be greater than zero');
        }
        newRequestedAllocation = round2(newRequestedAllocation + amt);
      }

      if (newRequestedAllocation > round2(remainingUnallocated + 0.001)) {
        throw new Error(`Requested allocation of ${newRequestedAllocation.toFixed(2)} exceeds available unallocated payment balance of ${remainingUnallocated.toFixed(2)}`);
      }

      // 3. Process each allocation
      for (const a of allocations) {
        const amt = round2(Number(a.allocatedAmount));
        if (payment.payment_type === 'RECEIPT') {
          if (a.documentType !== 'SALES_INVOICE') {
            throw new Error('Customer receipts can only be allocated to SALES_INVOICE');
          }
          const invRes = await client.query(
            `SELECT id, invoice_number, party_id, grand_total, status 
             FROM sales_invoices 
             WHERE business_id = $1 AND id = $2 
             FOR UPDATE`,
            [businessId, a.documentId]
          );
          if (invRes.rows.length === 0) throw new Error(`Sales invoice ${a.documentId} not found`);
          const inv = invRes.rows[0];
          if (inv.party_id !== payment.party_id) {
            throw new Error(`Invoice ${inv.invoice_number} does not belong to the payment's party`);
          }
          if (inv.status !== 'POSTED') {
            throw new Error(`Cannot allocate to invoice ${inv.invoice_number} with status ${inv.status}. Must be POSTED.`);
          }

          // Outstanding check (subtracting active payments and posted returns)
          const paidRes = await client.query(
            `SELECT COALESCE(SUM(allocated_amount), 0) as paid 
             FROM payment_allocations 
             WHERE business_id = $1 AND document_id = $2 AND status = 'ACTIVE'`,
            [businessId, inv.id]
          );
          const currentPaid = parseFloat(paidRes.rows[0]?.paid || '0');
          const retRes = await client.query(
            `SELECT COALESCE(SUM(grand_total), 0) as returned 
             FROM sales_returns 
             WHERE business_id = $1 AND sales_invoice_id = $2 AND status = 'POSTED'`,
            [businessId, inv.id]
          );
          const returnedAmt = parseFloat(retRes.rows[0]?.returned || '0');
          const outstanding = round2(Math.max(0, parseFloat(inv.grand_total) - currentPaid - returnedAmt));

          if (amt > round2(outstanding + 0.001)) {
            throw new Error(`Allocation of ${amt.toFixed(2)} exceeds invoice ${inv.invoice_number} outstanding of ${outstanding.toFixed(2)}`);
          }

          // Insert allocation
          await client.query(
            `INSERT INTO payment_allocations (
              business_id, payment_id, party_id, document_type,
              document_id, allocated_amount, status, notes,
              created_by, created_at, updated_at
            ) VALUES (
              $1, $2, $3, $4,
              $5, $6, 'ACTIVE', $7,
              $8, NOW(), NOW()
            )`,
            [
              businessId,
              paymentId,
              payment.party_id,
              a.documentType,
              a.documentId,
              amt.toFixed(2),
              a.notes || null,
              userId || null,
            ]
          );

          if (payment.status === 'POSTED') {
            await this.syncSalesInvoicePaymentStatus(client, businessId, inv.id);
          }
        } else {
          // PAYMENT -> PURCHASE_INVOICE
          if (a.documentType !== 'PURCHASE_INVOICE') {
            throw new Error('Supplier payments can only be allocated to PURCHASE_INVOICE');
          }
          const invRes = await client.query(
            `SELECT id, invoice_number, supplier_party_id, grand_total, status 
             FROM purchase_invoices 
             WHERE business_id = $1 AND id = $2 
             FOR UPDATE`,
            [businessId, a.documentId]
          );
          if (invRes.rows.length === 0) throw new Error(`Purchase invoice ${a.documentId} not found`);
          const inv = invRes.rows[0];
          if (inv.supplier_party_id !== payment.party_id) {
            throw new Error(`Purchase bill ${inv.invoice_number} does not belong to the payment's party`);
          }
          if (inv.status !== 'POSTED') {
            throw new Error(`Cannot allocate to purchase bill ${inv.invoice_number} with status ${inv.status}. Must be POSTED.`);
          }

          // Outstanding check (subtracting active payments and posted debit notes)
          const paidRes = await client.query(
            `SELECT COALESCE(SUM(allocated_amount), 0) as paid 
             FROM payment_allocations 
             WHERE business_id = $1 AND document_id = $2 AND status = 'ACTIVE'`,
            [businessId, inv.id]
          );
          const currentPaid = parseFloat(paidRes.rows[0]?.paid || '0');
          const retRes = await client.query(
            `SELECT COALESCE(SUM(grand_total), 0) as returned 
             FROM purchase_returns 
             WHERE business_id = $1 AND purchase_invoice_id = $2 AND status = 'POSTED'`,
            [businessId, inv.id]
          );
          const returnedAmt = parseFloat(retRes.rows[0]?.returned || '0');
          const outstanding = round2(Math.max(0, parseFloat(inv.grand_total) - currentPaid - returnedAmt));

          if (amt > round2(outstanding + 0.001)) {
            throw new Error(`Allocation of ${amt.toFixed(2)} exceeds purchase bill ${inv.invoice_number} outstanding of ${outstanding.toFixed(2)}`);
          }

          // Insert allocation
          await client.query(
            `INSERT INTO payment_allocations (
              business_id, payment_id, party_id, document_type,
              document_id, allocated_amount, status, notes,
              created_by, created_at, updated_at
            ) VALUES (
              $1, $2, $3, $4,
              $5, $6, 'ACTIVE', $7,
              $8, NOW(), NOW()
            )`,
            [
              businessId,
              paymentId,
              payment.party_id,
              a.documentType,
              a.documentId,
              amt.toFixed(2),
              a.notes || null,
              userId || null,
            ]
          );

          if (payment.status === 'POSTED') {
            await this.syncPurchaseInvoicePaymentStatus(client, businessId, inv.id);
          }
        }
      }

      // 4. Update payment unallocated amount
      const finalAllocsRes = await client.query(
        `SELECT COALESCE(SUM(allocated_amount), 0) as total_alloc 
         FROM payment_allocations 
         WHERE business_id = $1 AND payment_id = $2 AND status = 'ACTIVE'`,
        [businessId, paymentId]
      );
      const finalAllocated = parseFloat(finalAllocsRes.rows[0]?.total_alloc || '0');
      const finalUnallocated = round2(totalAmount - finalAllocated);

      await client.query(
        `UPDATE payments 
         SET unallocated_amount = $1, updated_at = NOW(), updated_by = $2 
         WHERE id = $3`,
        [finalUnallocated.toFixed(2), userId || null, paymentId]
      );

      await client.query('COMMIT');

      await AuditService.log({
        businessId,
        userId,
        module: 'payment',
        action: 'ALLOCATE_PAYMENT',
        entityType: 'PAYMENT',
        entityId: paymentId,
        newValue: {
          allocatedAmount: newRequestedAllocation,
          remainingUnallocated: finalUnallocated,
        },
      });

      return await this.getPaymentById(businessId, paymentId);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Cancels a Payment voucher and reverses ledger impacts
   */
  static async cancelPayment(
    businessId: string,
    paymentId: string,
    reason?: string,
    userId?: string
  ) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Lock payment
      const payRes = await client.query(
        `SELECT * FROM payments 
         WHERE business_id = $1 AND id = $2 
         FOR UPDATE`,
        [businessId, paymentId]
      );

      if (payRes.rows.length === 0) {
        throw new Error('Payment voucher not found');
      }

      const payment = payRes.rows[0];
      if (payment.status === 'CANCELLED') {
        throw new Error('Payment voucher is already CANCELLED');
      }

      const wasPosted = payment.status === 'POSTED';
      const amountNum = parseFloat(payment.amount);
      const partyId = payment.party_id;
      const paymentType = payment.payment_type;

      // 2. Cancel payment allocations
      const allocsRes = await client.query(
        `SELECT * FROM payment_allocations 
         WHERE business_id = $1 AND payment_id = $2 AND status = 'ACTIVE' 
         FOR UPDATE`,
        [businessId, paymentId]
      );

      await client.query(
        `UPDATE payment_allocations 
         SET status = 'CANCELLED', updated_at = NOW() 
         WHERE business_id = $1 AND payment_id = $2`,
        [businessId, paymentId]
      );

      // 3. If was POSTED, reverse ledger entries
      if (wasPosted) {
        if (paymentType === 'RECEIPT') {
          // Lock customer ledger
          const lastLedgerRes = await client.query(
            `SELECT balance FROM customer_ledgers 
             WHERE business_id = $1 AND party_id = $2 
             ORDER BY transaction_date DESC, created_at DESC 
             LIMIT 1 FOR UPDATE`,
            [businessId, partyId]
          );
          const prevBalance = lastLedgerRes.rows.length > 0 ? parseFloat(lastLedgerRes.rows[0].balance) : 0;
          const newBalance = round2(prevBalance + amountNum);

          await client.query(
            `INSERT INTO customer_ledgers (
              business_id, party_id, transaction_type, reference_type, reference_id,
              debit, credit, balance, transaction_date, notes, created_by, created_at
            ) VALUES (
              $1, $2, 'CANCELLATION_REVERSAL', 'PAYMENT_CANCEL', $3,
              $4, '0.00', $5, NOW(), $6, $7, NOW()
            )`,
            [
              businessId,
              partyId,
              paymentId,
              amountNum.toFixed(2),
              newBalance.toFixed(2),
              `Cancellation reversal of Receipt ${payment.payment_number}. Reason: ${reason || 'Cancelled'}`,
              userId || null,
            ]
          );

          // Restore sales invoice statuses
          for (const alloc of allocsRes.rows) {
            await this.syncSalesInvoicePaymentStatus(client, businessId, alloc.document_id);
          }
        } else {
          // PAYMENT -> Supplier Ledger
          const lastLedgerRes = await client.query(
            `SELECT balance FROM supplier_ledgers 
             WHERE business_id = $1 AND party_id = $2 
             ORDER BY transaction_date DESC, created_at DESC 
             LIMIT 1 FOR UPDATE`,
            [businessId, partyId]
          );
          const prevBalance = lastLedgerRes.rows.length > 0 ? parseFloat(lastLedgerRes.rows[0].balance) : 0;
          const newBalance = round2(prevBalance + amountNum);

          await client.query(
            `INSERT INTO supplier_ledgers (
              business_id, party_id, transaction_type, reference_type, reference_id,
              debit, credit, balance, transaction_date, notes, created_by, created_at
            ) VALUES (
              $1, $2, 'CANCELLATION_REVERSAL', 'PAYMENT_CANCEL', $3,
              '0.00', $4, $5, NOW(), $6, $7, NOW()
            )`,
            [
              businessId,
              partyId,
              paymentId,
              amountNum.toFixed(2),
              newBalance.toFixed(2),
              `Cancellation reversal of Supplier Payment ${payment.payment_number}. Reason: ${reason || 'Cancelled'}`,
              userId || null,
            ]
          );

          // Restore purchase invoice statuses
          for (const alloc of allocsRes.rows) {
            await this.syncPurchaseInvoicePaymentStatus(client, businessId, alloc.document_id);
          }
        }
      }

      // 4. Update payment master status
      await client.query(
        `UPDATE payments 
         SET status = 'CANCELLED', notes = COALESCE(notes || E'\\n', '') || $1, updated_at = NOW(), updated_by = $2 
         WHERE id = $3`,
        [`[CANCELLED: ${reason || 'Cancelled by user'}]`, userId || null, paymentId]
      );

      await client.query('COMMIT');

      await AuditService.log({
        businessId,
        userId,
        module: 'payment',
        action: 'CANCEL_PAYMENT',
        entityType: 'PAYMENT',
        entityId: paymentId,
        newValue: {
          paymentNumber: payment.payment_number,
          status: 'CANCELLED',
          reason,
        },
      });

      return await this.getPaymentById(businessId, paymentId);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Permanently deletes a Payment/Receipt voucher, restoring ledgers and invoice statuses
   */
  static async deletePayment(
    businessId: string,
    paymentId: string,
    userId?: string
  ) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const payRes = await client.query(
        `SELECT * FROM payments 
         WHERE business_id = $1 AND id = $2 
         FOR UPDATE`,
        [businessId, paymentId]
      );

      if (payRes.rows.length === 0) {
        throw new Error('Payment voucher not found');
      }

      const payment = payRes.rows[0];
      const wasPosted = payment.status === 'POSTED';
      const paymentType = payment.payment_type;

      // 1. Fetch allocated documents to sync their statuses later
      const allocsRes = await client.query(
        `SELECT * FROM payment_allocations 
         WHERE business_id = $1 AND payment_id = $2`,
        [businessId, paymentId]
      );

      // 2. Delete payment allocations
      await client.query(
        `DELETE FROM payment_allocations WHERE business_id = $1 AND payment_id = $2`,
        [businessId, paymentId]
      );

      // 3. Delete ledger entries created for this payment
      if (wasPosted) {
        if (paymentType === 'RECEIPT') {
          await client.query(
            `DELETE FROM customer_ledgers 
             WHERE business_id = $1 AND reference_type IN ('PAYMENT', 'PAYMENT_CANCEL') AND reference_id = $2`,
            [businessId, paymentId]
          );

          // Recalculate sales invoice statuses
          for (const alloc of allocsRes.rows) {
            await this.syncSalesInvoicePaymentStatus(client, businessId, alloc.document_id);
          }
        } else {
          await client.query(
            `DELETE FROM supplier_ledgers 
             WHERE business_id = $1 AND reference_type IN ('PAYMENT', 'PAYMENT_CANCEL') AND reference_id = $2`,
            [businessId, paymentId]
          );

          // Recalculate purchase invoice statuses
          for (const alloc of allocsRes.rows) {
            await this.syncPurchaseInvoicePaymentStatus(client, businessId, alloc.document_id);
          }
        }
      }

      // 4. Delete payment voucher
      await client.query(
        `DELETE FROM payments WHERE business_id = $1 AND id = $2`,
        [businessId, paymentId]
      );

      await client.query('COMMIT');

      await AuditService.log({
        businessId,
        userId,
        module: 'payment',
        action: 'DELETE_PAYMENT',
        entityType: 'PAYMENT',
        entityId: paymentId,
        previousValue: {
          paymentNumber: payment.payment_number,
          paymentType: payment.payment_type,
          amount: payment.amount,
          status: payment.status,
        },
      });

      return {
        success: true,
        message: `Payment/Receipt voucher ${payment.payment_number} deleted successfully.`,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Atomic helper for Cash Invoice creation with immediate settlement
   */
  static async createAndPostCashPayment(
    client: PoolClient,
    businessId: string,
    partyId: string,
    documentType: 'SALES_INVOICE' | 'PURCHASE_INVOICE',
    documentId: string,
    amount: number,
    paymentMode: string = 'CASH',
    userId?: string
  ) {
    const paymentType = documentType === 'SALES_INVOICE' ? 'RECEIPT' : 'PAYMENT';
    const paymentNumber = await this.generatePaymentNumber(businessId, paymentType, client);
    const amountNum = round2(amount);

    // 1. Insert Payment master as POSTED
    const payRes = await client.query(
      `INSERT INTO payments (
        business_id, party_id, payment_number, payment_date,
        payment_type, payment_mode, amount, unallocated_amount,
        notes, status, created_by, updated_by, created_at, updated_at
      ) VALUES (
        $1, $2, $3, NOW(),
        $4, $5, $6, '0.00',
        $7, 'POSTED', $8, $8, NOW(), NOW()
      ) RETURNING id`,
      [
        businessId,
        partyId,
        paymentNumber,
        paymentType,
        paymentMode,
        amountNum.toFixed(2),
        `Immediate ${paymentMode} settlement for ${documentType}`,
        userId || null,
      ]
    );
    const paymentId = payRes.rows[0].id;

    // 2. Insert Payment Allocation
    await client.query(
      `INSERT INTO payment_allocations (
        business_id, payment_id, party_id, document_type,
        document_id, allocated_amount, status, notes,
        created_by, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, 'ACTIVE', $7,
        $8, NOW(), NOW()
      )`,
      [
        businessId,
        paymentId,
        partyId,
        documentType,
        documentId,
        amountNum.toFixed(2),
        `Auto-allocation on ${documentType} settlement`,
        userId || null,
      ]
    );

    // 3. Update Ledgers
    if (paymentType === 'RECEIPT') {
      const lastLedgerRes = await client.query(
        `SELECT balance FROM customer_ledgers 
         WHERE business_id = $1 AND party_id = $2 
         ORDER BY transaction_date DESC, created_at DESC 
         LIMIT 1 FOR UPDATE`,
        [businessId, partyId]
      );
      const prevBalance = lastLedgerRes.rows.length > 0 ? parseFloat(lastLedgerRes.rows[0].balance) : 0;
      const newBalance = round2(prevBalance - amountNum);

      await client.query(
        `INSERT INTO customer_ledgers (
          business_id, party_id, transaction_type, reference_type, reference_id,
          debit, credit, balance, transaction_date, notes, created_by, created_at
        ) VALUES (
          $1, $2, 'RECEIPT', 'PAYMENT', $3,
          '0.00', $4, $5, NOW(), $6, $7, NOW()
        )`,
        [
          businessId,
          partyId,
          paymentId,
          amountNum.toFixed(2),
          newBalance.toFixed(2),
          `Cash Receipt ${paymentNumber}`,
          userId || null,
        ]
      );

      await this.syncSalesInvoicePaymentStatus(client, businessId, documentId);
    } else {
      const lastLedgerRes = await client.query(
        `SELECT balance FROM supplier_ledgers 
         WHERE business_id = $1 AND party_id = $2 
         ORDER BY transaction_date DESC, created_at DESC 
         LIMIT 1 FOR UPDATE`,
        [businessId, partyId]
      );
      const prevBalance = lastLedgerRes.rows.length > 0 ? parseFloat(lastLedgerRes.rows[0].balance) : 0;
      const newBalance = round2(prevBalance - amountNum);

      await client.query(
        `INSERT INTO supplier_ledgers (
          business_id, party_id, transaction_type, reference_type, reference_id,
          debit, credit, balance, transaction_date, notes, created_by, created_at
        ) VALUES (
          $1, $2, 'PAYMENT', 'PAYMENT', $3,
          $4, '0.00', $5, NOW(), $6, $7, NOW()
        )`,
        [
          businessId,
          partyId,
          paymentId,
          amountNum.toFixed(2),
          newBalance.toFixed(2),
          `Cash Payment ${paymentNumber}`,
          userId || null,
        ]
      );

      await this.syncPurchaseInvoicePaymentStatus(client, businessId, documentId);
    }

    return paymentId;
  }

  /**
   * Retrieves unpaid / partial invoices for a party to facilitate easy allocation
   */
  static async getUnpaidInvoices(
    businessId: string,
    partyId: string,
    paymentType: 'RECEIPT' | 'PAYMENT'
  ) {
    if (paymentType === 'RECEIPT') {
      const res = await pool.query(
        `SELECT 
           si.id,
           si.invoice_number as document_number,
           si.invoice_date as document_date,
           'SALES_INVOICE' as document_type,
           si.grand_total,
           si.payment_status,
           COALESCE(SUM(CASE WHEN pa.status = 'ACTIVE' AND p.status = 'POSTED' THEN pa.allocated_amount ELSE 0 END), 0) as paid_amount,
           COALESCE(sr.returns_total, 0) as returned_amount
         FROM sales_invoices si
         LEFT JOIN (
           SELECT sales_invoice_id, SUM(grand_total) as returns_total 
           FROM sales_returns 
           WHERE business_id = $1 AND status = 'POSTED' 
           GROUP BY sales_invoice_id
         ) sr ON sr.sales_invoice_id = si.id
         LEFT JOIN payment_allocations pa ON pa.document_id = si.id AND pa.business_id = si.business_id
         LEFT JOIN payments p ON p.id = pa.payment_id
         WHERE si.business_id = $1 AND si.party_id = $2 AND si.status = 'POSTED'
         GROUP BY si.id, si.invoice_number, si.invoice_date, si.grand_total, si.payment_status, sr.returns_total
         ORDER BY si.invoice_date ASC, si.created_at ASC`,
        [businessId, partyId]
      );

      return res.rows
        .map(r => {
          const grandTotal = parseFloat(r.grand_total);
          const paidAmount = parseFloat(r.paid_amount);
          const returnedAmount = parseFloat(r.returned_amount);
          const paidOrAdjusted = round2(paidAmount + returnedAmount);
          const outstanding = round2(Math.max(0, grandTotal - paidOrAdjusted));
          return {
            id: r.id,
            documentNumber: r.document_number,
            documentDate: r.document_date,
            documentType: r.document_type,
            grandTotal,
            paidAmount,
            returnedAmount,
            paidOrAdjustedAmount: paidOrAdjusted,
            outstandingAmount: outstanding,
            paymentStatus: r.payment_status,
          };
        })
        .filter(r => r.outstandingAmount > 0.001);
    } else {
      const res = await pool.query(
        `SELECT 
           pi.id,
           pi.invoice_number as document_number,
           pi.invoice_date as document_date,
           'PURCHASE_INVOICE' as document_type,
           pi.grand_total,
           pi.payment_status,
           COALESCE(SUM(CASE WHEN pa.status = 'ACTIVE' AND p.status = 'POSTED' THEN pa.allocated_amount ELSE 0 END), 0) as paid_amount,
           COALESCE(pr.returns_total, 0) as returned_amount
         FROM purchase_invoices pi
         LEFT JOIN (
           SELECT purchase_invoice_id, SUM(grand_total) as returns_total 
           FROM purchase_returns 
           WHERE business_id = $1 AND status = 'POSTED' 
           GROUP BY purchase_invoice_id
         ) pr ON pr.purchase_invoice_id = pi.id
         LEFT JOIN payment_allocations pa ON pa.document_id = pi.id AND pa.business_id = pi.business_id
         LEFT JOIN payments p ON p.id = pa.payment_id
         WHERE pi.business_id = $1 AND pi.supplier_party_id = $2 AND pi.status = 'POSTED'
         GROUP BY pi.id, pi.invoice_number, pi.invoice_date, pi.grand_total, pi.payment_status, pr.returns_total
         ORDER BY pi.invoice_date ASC, pi.created_at ASC`,
        [businessId, partyId]
      );

      return res.rows
        .map(r => {
          const grandTotal = parseFloat(r.grand_total);
          const paidAmount = parseFloat(r.paid_amount);
          const returnedAmount = parseFloat(r.returned_amount);
          const paidOrAdjusted = round2(paidAmount + returnedAmount);
          const outstanding = round2(Math.max(0, grandTotal - paidOrAdjusted));
          return {
            id: r.id,
            documentNumber: r.document_number,
            documentDate: r.document_date,
            documentType: r.document_type,
            grandTotal,
            paidAmount,
            returnedAmount,
            paidOrAdjustedAmount: paidOrAdjusted,
            outstandingAmount: outstanding,
            paymentStatus: r.payment_status,
          };
        })
        .filter(r => r.outstandingAmount > 0.001);
    }
  }

  /**
   * Retrieves single payment with allocations and linked invoice details
   */
  static async getPaymentById(businessId: string, paymentId: string) {
    const payRes = await pool.query(
      `SELECT 
         p.*,
         pt.name as party_name,
         pt.mobile as party_phone,
         pt.email as party_email,
         pt.party_type,
         u.full_name as created_by_name
       FROM payments p
       JOIN parties pt ON pt.id = p.party_id
       LEFT JOIN users u ON u.id = p.created_by
       WHERE p.business_id = $1 AND p.id = $2`,
      [businessId, paymentId]
    );

    if (payRes.rows.length === 0) return null;
    const payment = payRes.rows[0];

    // Fetch allocations
    const allocsRes = await pool.query(
      `SELECT 
         pa.*,
         COALESCE(si.invoice_number, pi.invoice_number) as document_number,
         COALESCE(si.invoice_date, pi.invoice_date) as document_date,
         COALESCE(si.grand_total, pi.grand_total) as document_grand_total,
         COALESCE(si.payment_status, pi.payment_status) as document_payment_status
       FROM payment_allocations pa
       LEFT JOIN sales_invoices si ON pa.document_type = 'SALES_INVOICE' AND si.id = pa.document_id
       LEFT JOIN purchase_invoices pi ON pa.document_type = 'PURCHASE_INVOICE' AND pi.id = pa.document_id
       WHERE pa.business_id = $1 AND pa.payment_id = $2
       ORDER BY pa.created_at ASC`,
      [businessId, paymentId]
    );

    return {
      ...payment,
      amount: parseFloat(payment.amount),
      unallocatedAmount: parseFloat(payment.unallocated_amount),
      allocations: allocsRes.rows.map(a => ({
        ...a,
        allocatedAmount: parseFloat(a.allocated_amount),
        documentGrandTotal: a.document_grand_total ? parseFloat(a.document_grand_total) : null,
      })),
    };
  }

  /**
   * Retrieves list of payments with filtering
   */
  static async getPayments(
    businessId: string,
    filters?: {
      partyId?: string;
      paymentType?: 'RECEIPT' | 'PAYMENT';
      paymentMode?: string;
      status?: string;
      search?: string;
      fromDate?: string;
      toDate?: string;
      page?: number;
      limit?: number;
    }
  ) {
    const page = filters?.page || 1;
    const limit = filters?.limit || 50;
    const offset = (page - 1) * limit;

    const conditions: string[] = [`p.business_id = $1`];
    const params: any[] = [businessId];
    let pIdx = 2;

    if (filters?.partyId) {
      conditions.push(`p.party_id = $${pIdx++}`);
      params.push(filters.partyId);
    }
    if (filters?.paymentType) {
      conditions.push(`p.payment_type = $${pIdx++}`);
      params.push(filters.paymentType);
    }
    if (filters?.paymentMode) {
      conditions.push(`p.payment_mode = $${pIdx++}`);
      params.push(filters.paymentMode);
    }
    if (filters?.status) {
      conditions.push(`p.status = $${pIdx++}`);
      params.push(filters.status);
    }
    if (filters?.fromDate) {
      conditions.push(`p.payment_date >= $${pIdx++}`);
      params.push(filters.fromDate);
    }
    if (filters?.toDate) {
      conditions.push(`p.payment_date <= $${pIdx++}`);
      params.push(filters.toDate);
    }
    if (filters?.search) {
      conditions.push(`(p.payment_number ILIKE $${pIdx} OR pt.name ILIKE $${pIdx} OR p.reference_number ILIKE $${pIdx})`);
      params.push(`%${filters.search}%`);
      pIdx++;
    }

    const whereClause = conditions.join(' AND ');

    const countRes = await pool.query(
      `SELECT COUNT(*) as total 
       FROM payments p
       JOIN parties pt ON pt.id = p.party_id
       WHERE ${whereClause}`,
      params
    );
    const total = parseInt(countRes.rows[0]?.total || '0', 10);

    const listRes = await pool.query(
      `SELECT 
         p.*,
         pt.name as party_name,
         pt.mobile as party_phone,
         pt.party_type,
         u.full_name as created_by_name,
         (SELECT COUNT(*) FROM payment_allocations pa WHERE pa.payment_id = p.id AND pa.status = 'ACTIVE') as allocations_count
       FROM payments p
       JOIN parties pt ON pt.id = p.party_id
       LEFT JOIN users u ON u.id = p.created_by
       WHERE ${whereClause}
       ORDER BY p.payment_date DESC, p.created_at DESC
       LIMIT $${pIdx++} OFFSET $${pIdx++}`,
      [...params, limit, offset]
    );

    return {
      payments: listRes.rows.map(p => ({
        ...p,
        amount: parseFloat(p.amount),
        unallocatedAmount: parseFloat(p.unallocated_amount),
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Helper to format readable voucher type
   */
  private static getReadableVoucherType(transactionType: string, referenceType?: string, partyRole?: string): string {
    switch (transactionType) {
      case 'SALE':
        return 'Sales Invoice';
      case 'PURCHASE':
        return 'Purchase Bill';
      case 'RECEIPT':
      case 'PAYMENT_RECEIVED':
        return 'Customer Receipt';
      case 'PAYMENT':
        return partyRole === 'SUPPLIER' ? 'Supplier Payment' : 'Payment';
      case 'SALES_RETURN':
        return 'Sales Return (Credit Note)';
      case 'PURCHASE_RETURN':
        return 'Purchase Return (Debit Note)';
      case 'CREDIT_NOTE':
        return 'Credit Note';
      case 'DEBIT_NOTE':
        return 'Debit Note';
      case 'CANCELLATION_REVERSAL':
        return 'Cancellation Reversal';
      case 'OPENING_BALANCE':
        return 'Opening Balance';
      case 'ADJUSTMENT':
        return 'Adjustment';
      default:
        return transactionType || referenceType || 'Voucher';
    }
  }

  /**
   * Customer Outstanding Overview (Party-wise summary with 6 aging buckets & as-of date)
   */
  static async getCustomerOutstanding(
    businessId: string,
    filters?: { search?: string; asOfDate?: string }
  ) {
    const asOfDateStr = filters?.asOfDate ? filters.asOfDate : new Date().toISOString().split('T')[0];
    const params: any[] = [businessId, asOfDateStr];
    let searchFilter = '';
    if (filters?.search?.trim()) {
      params.push(`%${filters.search.trim()}%`);
      searchFilter = `AND (p.name ILIKE $${params.length} OR p.mobile ILIKE $${params.length} OR p.party_code ILIKE $${params.length})`;
    }

    const query = `
      WITH LatestLedger AS (
        SELECT DISTINCT ON (party_id) party_id, balance, transaction_date
        FROM customer_ledgers
        WHERE business_id = $1 AND transaction_date <= ($2::date + interval '1 day' - interval '1 millisecond')
        ORDER BY party_id, transaction_date DESC, created_at DESC, id DESC
      ),
      InvoicesAsOf AS (
        SELECT 
          si.party_id,
          si.id as invoice_id,
          si.invoice_date,
          COALESCE(si.due_date, (si.invoice_date + (COALESCE(p.credit_days, '0')::int * INTERVAL '1 day'))) as due_date,
          si.grand_total,
          COALESCE(pa.paid, 0) as paid_amount,
          COALESCE(sr.returns_total, 0) as returned_amount,
          GREATEST(0, si.grand_total - (COALESCE(pa.paid, 0) + COALESCE(sr.returns_total, 0))) as outstanding
        FROM sales_invoices si
        JOIN parties p ON p.id = si.party_id
        LEFT JOIN (
          SELECT pa.document_id, SUM(pa.allocated_amount) as paid
          FROM payment_allocations pa
          JOIN payments pay ON pay.id = pa.payment_id
          WHERE pa.business_id = $1 AND pa.status = 'ACTIVE' AND pay.status = 'POSTED'
            AND pay.payment_date <= ($2::date + interval '1 day' - interval '1 millisecond')
          GROUP BY pa.document_id
        ) pa ON pa.document_id = si.id
        LEFT JOIN (
          SELECT sales_invoice_id, SUM(grand_total) as returns_total
          FROM sales_returns
          WHERE business_id = $1 AND status = 'POSTED'
            AND return_date <= ($2::date + interval '1 day' - interval '1 millisecond')
          GROUP BY sales_invoice_id
        ) sr ON sr.sales_invoice_id = si.id
        WHERE si.business_id = $1 AND si.status = 'POSTED'
          AND si.invoice_date <= ($2::date + interval '1 day' - interval '1 millisecond')
      ),
      UnpaidInvoices AS (
        SELECT 
          inv.party_id,
          COUNT(inv.invoice_id) FILTER (WHERE inv.outstanding > 0.001) as unpaid_count,
          MIN(inv.invoice_date) FILTER (WHERE inv.outstanding > 0.001) as oldest_invoice_date,
          MIN(inv.due_date) FILTER (WHERE inv.outstanding > 0.001 AND inv.due_date::date < $2::date) as oldest_overdue_date,
          COALESCE(SUM(inv.outstanding) FILTER (WHERE inv.outstanding > 0.001), 0) as total_unpaid_amount,
          COALESCE(SUM(inv.outstanding) FILTER (WHERE inv.outstanding > 0.001 AND inv.due_date::date >= $2::date), 0) as current_not_due,
          COALESCE(SUM(inv.outstanding) FILTER (WHERE inv.outstanding > 0.001 AND ($2::date - inv.due_date::date) BETWEEN 1 AND 30), 0) as bucket_1_30,
          COALESCE(SUM(inv.outstanding) FILTER (WHERE inv.outstanding > 0.001 AND ($2::date - inv.due_date::date) BETWEEN 31 AND 60), 0) as bucket_31_60,
          COALESCE(SUM(inv.outstanding) FILTER (WHERE inv.outstanding > 0.001 AND ($2::date - inv.due_date::date) BETWEEN 61 AND 90), 0) as bucket_61_90,
          COALESCE(SUM(inv.outstanding) FILTER (WHERE inv.outstanding > 0.001 AND ($2::date - inv.due_date::date) BETWEEN 91 AND 180), 0) as bucket_91_180,
          COALESCE(SUM(inv.outstanding) FILTER (WHERE inv.outstanding > 0.001 AND ($2::date - inv.due_date::date) > 180), 0) as bucket_over_180
        FROM InvoicesAsOf inv
        GROUP BY inv.party_id
      )
      SELECT 
        p.id as party_id,
        p.party_code,
        p.name as party_name,
        p.mobile as phone,
        p.email,
        p.city,
        p.credit_limit,
        p.credit_days,
        COALESCE(ll.balance, '0.00') as current_balance,
        COALESCE(ui.unpaid_count, 0) as unpaid_invoices_count,
        ui.oldest_invoice_date,
        ui.oldest_overdue_date,
        COALESCE(ui.total_unpaid_amount, 0) as total_unpaid_amount,
        COALESCE(ui.current_not_due, 0) as current_not_due,
        COALESCE(ui.bucket_1_30, 0) as bucket_1_30,
        COALESCE(ui.bucket_31_60, 0) as bucket_31_60,
        COALESCE(ui.bucket_61_90, 0) as bucket_61_90,
        COALESCE(ui.bucket_91_180, 0) as bucket_91_180,
        COALESCE(ui.bucket_over_180, 0) as bucket_over_180
      FROM parties p
      LEFT JOIN LatestLedger ll ON ll.party_id = p.id
      LEFT JOIN UnpaidInvoices ui ON ui.party_id = p.id
      WHERE p.business_id = $1 
        AND p.party_type IN ('CUSTOMER', 'BOTH')
        ${searchFilter}
      ORDER BY COALESCE(ll.balance::numeric, 0) DESC, p.name ASC
    `;

    const res = await pool.query(query, params);
    return res.rows.map(r => {
      const creditLimit = r.credit_limit ? parseFloat(r.credit_limit) : 0;
      const creditDays = r.credit_days ? parseInt(r.credit_days, 10) : 0;
      const currentBalance = parseFloat(r.current_balance) || 0;
      const totalReceivable = parseFloat(r.total_unpaid_amount) || 0;
      const notDue = parseFloat(r.current_not_due) || 0;
      const b1 = parseFloat(r.bucket_1_30) || 0;
      const b2 = parseFloat(r.bucket_31_60) || 0;
      const b3 = parseFloat(r.bucket_61_90) || 0;
      const b4 = parseFloat(r.bucket_91_180) || 0;
      const b5 = parseFloat(r.bucket_over_180) || 0;
      const overdueTotal = round2(b1 + b2 + b3 + b4 + b5);
      const availableCredit = creditLimit > 0 ? round2(Math.max(0, creditLimit - totalReceivable)) : null;

      return {
        partyId: r.party_id,
        partyCode: r.party_code,
        partyName: r.party_name,
        partyPhone: r.phone,
        partyCity: r.city,
        phone: r.phone,
        email: r.email,
        creditLimit,
        creditDays,
        availableCredit,
        totalBalance: currentBalance,
        currentBalance,
        balanceDrCr: currentBalance >= 0 ? 'Dr' : 'Cr',
        balanceFormatted: `₹${Math.abs(currentBalance).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currentBalance >= 0 ? 'Dr' : 'Cr'}`,
        totalReceivable,
        notDueAmount: notDue,
        overdueAmount: overdueTotal,
        oldestDueDate: r.oldest_overdue_date || r.oldest_invoice_date || null,
        oldestInvoiceDate: r.oldest_invoice_date || null,
        unpaidInvoicesCount: parseInt(r.unpaid_invoices_count, 10) || 0,
        aging: {
          currentNotDue: notDue,
          bucket1To30: b1,
          bucket31To60: b2,
          bucket61To90: b3,
          bucket91To180: b4,
          bucketOver180: b5,
          bucket0To30: round2(notDue + b1),
          bucketOver90: round2(b4 + b5),
        },
      };
    });
  }

  /**
   * Supplier Outstanding Overview (Party-wise summary with 6 aging buckets & as-of date)
   */
  static async getSupplierOutstanding(
    businessId: string,
    filters?: { search?: string; asOfDate?: string }
  ) {
    const asOfDateStr = filters?.asOfDate ? filters.asOfDate : new Date().toISOString().split('T')[0];
    const params: any[] = [businessId, asOfDateStr];
    let searchFilter = '';
    if (filters?.search?.trim()) {
      params.push(`%${filters.search.trim()}%`);
      searchFilter = `AND (p.name ILIKE $${params.length} OR p.mobile ILIKE $${params.length} OR p.party_code ILIKE $${params.length})`;
    }

    const query = `
      WITH LatestLedger AS (
        SELECT DISTINCT ON (party_id) party_id, balance, transaction_date
        FROM supplier_ledgers
        WHERE business_id = $1 AND transaction_date <= ($2::date + interval '1 day' - interval '1 millisecond')
        ORDER BY party_id, transaction_date DESC, created_at DESC, id DESC
      ),
      BillsAsOf AS (
        SELECT 
          pi.supplier_party_id as party_id,
          pi.id as invoice_id,
          pi.invoice_date,
          COALESCE(pi.due_date, (pi.invoice_date + (COALESCE(p.credit_days, '0')::int * INTERVAL '1 day'))) as due_date,
          pi.grand_total,
          COALESCE(pa.paid, 0) as paid_amount,
          COALESCE(pr.returns_total, 0) as returned_amount,
          GREATEST(0, pi.grand_total - (COALESCE(pa.paid, 0) + COALESCE(pr.returns_total, 0))) as outstanding
        FROM purchase_invoices pi
        JOIN parties p ON p.id = pi.supplier_party_id
        LEFT JOIN (
          SELECT pa.document_id, SUM(pa.allocated_amount) as paid
          FROM payment_allocations pa
          JOIN payments pay ON pay.id = pa.payment_id
          WHERE pa.business_id = $1 AND pa.status = 'ACTIVE' AND pay.status = 'POSTED'
            AND pay.payment_date <= ($2::date + interval '1 day' - interval '1 millisecond')
          GROUP BY pa.document_id
        ) pa ON pa.document_id = pi.id
        LEFT JOIN (
          SELECT purchase_invoice_id, SUM(grand_total) as returns_total
          FROM purchase_returns
          WHERE business_id = $1 AND status = 'POSTED'
            AND return_date <= ($2::date + interval '1 day' - interval '1 millisecond')
          GROUP BY purchase_invoice_id
        ) pr ON pr.purchase_invoice_id = pi.id
        WHERE pi.business_id = $1 AND pi.status = 'POSTED'
          AND pi.invoice_date <= ($2::date + interval '1 day' - interval '1 millisecond')
      ),
      UnpaidBills AS (
        SELECT 
          b.party_id,
          COUNT(b.invoice_id) FILTER (WHERE b.outstanding > 0.001) as unpaid_count,
          MIN(b.invoice_date) FILTER (WHERE b.outstanding > 0.001) as oldest_bill_date,
          MIN(b.due_date) FILTER (WHERE b.outstanding > 0.001 AND b.due_date::date < $2::date) as oldest_overdue_date,
          COALESCE(SUM(b.outstanding) FILTER (WHERE b.outstanding > 0.001), 0) as total_unpaid_amount,
          COALESCE(SUM(b.outstanding) FILTER (WHERE b.outstanding > 0.001 AND b.due_date::date >= $2::date), 0) as current_not_due,
          COALESCE(SUM(b.outstanding) FILTER (WHERE b.outstanding > 0.001 AND ($2::date - b.due_date::date) BETWEEN 1 AND 30), 0) as bucket_1_30,
          COALESCE(SUM(b.outstanding) FILTER (WHERE b.outstanding > 0.001 AND ($2::date - b.due_date::date) BETWEEN 31 AND 60), 0) as bucket_31_60,
          COALESCE(SUM(b.outstanding) FILTER (WHERE b.outstanding > 0.001 AND ($2::date - b.due_date::date) BETWEEN 61 AND 90), 0) as bucket_61_90,
          COALESCE(SUM(b.outstanding) FILTER (WHERE b.outstanding > 0.001 AND ($2::date - b.due_date::date) BETWEEN 91 AND 180), 0) as bucket_91_180,
          COALESCE(SUM(b.outstanding) FILTER (WHERE b.outstanding > 0.001 AND ($2::date - b.due_date::date) > 180), 0) as bucket_over_180
        FROM BillsAsOf b
        GROUP BY b.party_id
      )
      SELECT 
        p.id as party_id,
        p.party_code,
        p.name as party_name,
        p.mobile as phone,
        p.email,
        p.city,
        p.credit_limit,
        p.credit_days,
        COALESCE(ll.balance, '0.00') as current_balance,
        COALESCE(ub.unpaid_count, 0) as unpaid_bills_count,
        ub.oldest_bill_date,
        ub.oldest_overdue_date,
        COALESCE(ub.total_unpaid_amount, 0) as total_unpaid_amount,
        COALESCE(ub.current_not_due, 0) as current_not_due,
        COALESCE(ub.bucket_1_30, 0) as bucket_1_30,
        COALESCE(ub.bucket_31_60, 0) as bucket_31_60,
        COALESCE(ub.bucket_61_90, 0) as bucket_61_90,
        COALESCE(ub.bucket_91_180, 0) as bucket_91_180,
        COALESCE(ub.bucket_over_180, 0) as bucket_over_180
      FROM parties p
      LEFT JOIN LatestLedger ll ON ll.party_id = p.id
      LEFT JOIN UnpaidBills ub ON ub.party_id = p.id
      WHERE p.business_id = $1 
        AND p.party_type IN ('SUPPLIER', 'BOTH')
        ${searchFilter}
      ORDER BY COALESCE(ll.balance::numeric, 0) DESC, p.name ASC
    `;

    const res = await pool.query(query, params);
    return res.rows.map(r => {
      const creditLimit = r.credit_limit ? parseFloat(r.credit_limit) : 0;
      const creditDays = r.credit_days ? parseInt(r.credit_days, 10) : 0;
      const currentBalance = parseFloat(r.current_balance) || 0;
      const totalPayable = parseFloat(r.total_unpaid_amount) || 0;
      const notDue = parseFloat(r.current_not_due) || 0;
      const b1 = parseFloat(r.bucket_1_30) || 0;
      const b2 = parseFloat(r.bucket_31_60) || 0;
      const b3 = parseFloat(r.bucket_61_90) || 0;
      const b4 = parseFloat(r.bucket_91_180) || 0;
      const b5 = parseFloat(r.bucket_over_180) || 0;
      const overdueTotal = round2(b1 + b2 + b3 + b4 + b5);

      return {
        partyId: r.party_id,
        partyCode: r.party_code,
        partyName: r.party_name,
        partyPhone: r.phone,
        partyCity: r.city,
        phone: r.phone,
        email: r.email,
        creditLimit,
        creditDays,
        totalBalance: currentBalance,
        currentBalance,
        balanceDrCr: currentBalance >= 0 ? 'Cr' : 'Dr',
        balanceFormatted: `₹${Math.abs(currentBalance).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currentBalance >= 0 ? 'Cr' : 'Dr'}`,
        totalPayable,
        notDueAmount: notDue,
        overdueAmount: overdueTotal,
        oldestDueDate: r.oldest_overdue_date || r.oldest_bill_date || null,
        oldestBillDate: r.oldest_bill_date || null,
        unpaidBillsCount: parseInt(r.unpaid_bills_count, 10) || 0,
        unpaidInvoicesCount: parseInt(r.unpaid_bills_count, 10) || 0,
        aging: {
          currentNotDue: notDue,
          bucket1To30: b1,
          bucket31To60: b2,
          bucket61To90: b3,
          bucket91To180: b4,
          bucketOver180: b5,
          bucket0To30: round2(notDue + b1),
          bucketOver90: round2(b4 + b5),
        },
      };
    });
  }

  /**
   * Invoice-Wise Customer Outstanding (Detailed line-by-line view with Due Date, Paid/Adjusted, Overdue Days)
   */
  static async getInvoiceWiseCustomerOutstanding(
    businessId: string,
    filters?: {
      partyId?: string;
      search?: string;
      asOfDate?: string;
      status?: 'ALL' | 'UNPAID' | 'PARTIAL' | 'PAID' | 'OVERDUE';
    }
  ) {
    const asOfDateStr = filters?.asOfDate ? filters.asOfDate : new Date().toISOString().split('T')[0];
    const params: any[] = [businessId, asOfDateStr];
    const conditions: string[] = [
      `si.business_id = $1`,
      `si.status = 'POSTED'`,
      `si.invoice_date <= ($2::date + interval '1 day' - interval '1 millisecond')`,
    ];

    if (filters?.partyId) {
      params.push(filters.partyId);
      conditions.push(`si.party_id = $${params.length}`);
    }

    if (filters?.search?.trim()) {
      params.push(`%${filters.search.trim()}%`);
      conditions.push(`(si.invoice_number ILIKE $${params.length} OR p.name ILIKE $${params.length} OR p.party_code ILIKE $${params.length})`);
    }

    const whereClause = conditions.join(' AND ');

    const query = `
      SELECT 
        si.id as invoice_id,
        si.invoice_number,
        si.invoice_date,
        p.id as party_id,
        p.party_code,
        p.name as party_name,
        p.mobile as party_phone,
        p.city as party_city,
        COALESCE(si.credit_days_snapshot, COALESCE(p.credit_days, '0')::int) as credit_days,
        COALESCE(si.due_date, (si.invoice_date + (COALESCE(p.credit_days, '0')::int * INTERVAL '1 day'))) as due_date,
        si.grand_total,
        si.payment_status,
        COALESCE(pa.paid, 0) as paid_amount,
        COALESCE(sr.returns_total, 0) as returned_amount
      FROM sales_invoices si
      JOIN parties p ON p.id = si.party_id
      LEFT JOIN (
        SELECT pa.document_id, SUM(pa.allocated_amount) as paid
        FROM payment_allocations pa
        JOIN payments pay ON pay.id = pa.payment_id
        WHERE pa.business_id = $1 AND pa.status = 'ACTIVE' AND pay.status = 'POSTED'
          AND pay.payment_date <= ($2::date + interval '1 day' - interval '1 millisecond')
        GROUP BY pa.document_id
      ) pa ON pa.document_id = si.id
      LEFT JOIN (
        SELECT sales_invoice_id, SUM(grand_total) as returns_total
        FROM sales_returns
        WHERE business_id = $1 AND status = 'POSTED'
          AND return_date <= ($2::date + interval '1 day' - interval '1 millisecond')
        GROUP BY sales_invoice_id
      ) sr ON sr.sales_invoice_id = si.id
      WHERE ${whereClause}
      ORDER BY si.invoice_date DESC, si.created_at DESC
    `;

    const res = await pool.query(query, params);
    const asOfDateObj = new Date(asOfDateStr);

    return res.rows.map(r => {
      const grandTotal = parseFloat(r.grand_total);
      const paidAmount = parseFloat(r.paid_amount);
      const returnedAmount = parseFloat(r.returned_amount);
      const paidOrAdjusted = round2(paidAmount + returnedAmount);
      const outstanding = round2(Math.max(0, grandTotal - paidOrAdjusted));
      const dueDateObj = new Date(r.due_date);
      
      const diffMs = asOfDateObj.getTime() - dueDateObj.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      const overdueDays = outstanding > 0.001 && diffDays > 0 ? diffDays : 0;
      const isOverdue = overdueDays > 0;

      let agingBucket = 'CURRENT_NOT_DUE';
      if (overdueDays > 180) agingBucket = 'OVER_180';
      else if (overdueDays >= 91) agingBucket = '91_180';
      else if (overdueDays >= 61) agingBucket = '61_90';
      else if (overdueDays >= 31) agingBucket = '31_60';
      else if (overdueDays >= 1) agingBucket = '1_30';

      let effectiveStatus = 'UNPAID';
      if (outstanding <= 0.001) effectiveStatus = 'PAID';
      else if (paidOrAdjusted > 0.001) effectiveStatus = 'PARTIAL';

      return {
        invoiceId: r.invoice_id,
        invoiceNumber: r.invoice_number,
        invoiceDate: r.invoice_date,
        dueDate: r.due_date,
        creditDays: r.credit_days,
        partyId: r.party_id,
        partyCode: r.party_code,
        partyName: r.party_name,
        partyPhone: r.party_phone,
        partyCity: r.party_city,
        invoiceAmount: grandTotal,
        paidAmount,
        returnedAmount,
        paidOrAdjustedAmount: paidOrAdjusted,
        outstandingAmount: outstanding,
        overdueDays,
        isOverdue,
        agingBucket,
        paymentStatus: effectiveStatus,
      };
    }).filter(item => {
      if (filters?.status === 'OVERDUE') return item.isOverdue;
      if (filters?.status === 'UNPAID') return item.paymentStatus === 'UNPAID';
      if (filters?.status === 'PARTIAL') return item.paymentStatus === 'PARTIAL';
      if (filters?.status === 'PAID') return item.paymentStatus === 'PAID';
      return true;
    });
  }

  /**
   * Invoice-Wise Supplier Outstanding (Detailed line-by-line view with Due Date, Paid/Adjusted, Overdue Days)
   */
  static async getInvoiceWiseSupplierOutstanding(
    businessId: string,
    filters?: {
      partyId?: string;
      search?: string;
      asOfDate?: string;
      status?: 'ALL' | 'UNPAID' | 'PARTIAL' | 'PAID' | 'OVERDUE';
    }
  ) {
    const asOfDateStr = filters?.asOfDate ? filters.asOfDate : new Date().toISOString().split('T')[0];
    const params: any[] = [businessId, asOfDateStr];
    const conditions: string[] = [
      `pi.business_id = $1`,
      `pi.status = 'POSTED'`,
      `pi.invoice_date <= ($2::date + interval '1 day' - interval '1 millisecond')`,
    ];

    if (filters?.partyId) {
      params.push(filters.partyId);
      conditions.push(`pi.supplier_party_id = $${params.length}`);
    }

    if (filters?.search?.trim()) {
      params.push(`%${filters.search.trim()}%`);
      conditions.push(`(pi.invoice_number ILIKE $${params.length} OR p.name ILIKE $${params.length} OR p.party_code ILIKE $${params.length})`);
    }

    const whereClause = conditions.join(' AND ');

    const query = `
      SELECT 
        pi.id as invoice_id,
        pi.invoice_number,
        pi.invoice_date,
        p.id as party_id,
        p.party_code,
        p.name as party_name,
        p.mobile as party_phone,
        p.city as party_city,
        COALESCE(pi.credit_days_snapshot, COALESCE(p.credit_days, '0')::int) as credit_days,
        COALESCE(pi.due_date, (pi.invoice_date + (COALESCE(p.credit_days, '0')::int * INTERVAL '1 day'))) as due_date,
        pi.grand_total,
        pi.payment_status,
        COALESCE(pa.paid, 0) as paid_amount,
        COALESCE(pr.returns_total, 0) as returned_amount
      FROM purchase_invoices pi
      JOIN parties p ON p.id = pi.supplier_party_id
      LEFT JOIN (
        SELECT pa.document_id, SUM(pa.allocated_amount) as paid
        FROM payment_allocations pa
        JOIN payments pay ON pay.id = pa.payment_id
        WHERE pa.business_id = $1 AND pa.status = 'ACTIVE' AND pay.status = 'POSTED'
          AND pay.payment_date <= ($2::date + interval '1 day' - interval '1 millisecond')
        GROUP BY pa.document_id
      ) pa ON pa.document_id = pi.id
      LEFT JOIN (
        SELECT purchase_invoice_id, SUM(grand_total) as returns_total
        FROM purchase_returns
        WHERE business_id = $1 AND status = 'POSTED'
          AND return_date <= ($2::date + interval '1 day' - interval '1 millisecond')
        GROUP BY purchase_invoice_id
      ) pr ON pr.purchase_invoice_id = pi.id
      WHERE ${whereClause}
      ORDER BY pi.invoice_date DESC, pi.created_at DESC
    `;

    const res = await pool.query(query, params);
    const asOfDateObj = new Date(asOfDateStr);

    return res.rows.map(r => {
      const grandTotal = parseFloat(r.grand_total);
      const paidAmount = parseFloat(r.paid_amount);
      const returnedAmount = parseFloat(r.returned_amount);
      const paidOrAdjusted = round2(paidAmount + returnedAmount);
      const outstanding = round2(Math.max(0, grandTotal - paidOrAdjusted));
      const dueDateObj = new Date(r.due_date);
      
      const diffMs = asOfDateObj.getTime() - dueDateObj.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      const overdueDays = outstanding > 0.001 && diffDays > 0 ? diffDays : 0;
      const isOverdue = overdueDays > 0;

      let agingBucket = 'CURRENT_NOT_DUE';
      if (overdueDays > 180) agingBucket = 'OVER_180';
      else if (overdueDays >= 91) agingBucket = '91_180';
      else if (overdueDays >= 61) agingBucket = '61_90';
      else if (overdueDays >= 31) agingBucket = '31_60';
      else if (overdueDays >= 1) agingBucket = '1_30';

      let effectiveStatus = 'UNPAID';
      if (outstanding <= 0.001) effectiveStatus = 'PAID';
      else if (paidOrAdjusted > 0.001) effectiveStatus = 'PARTIAL';

      return {
        invoiceId: r.invoice_id,
        invoiceNumber: r.invoice_number,
        invoiceDate: r.invoice_date,
        dueDate: r.due_date,
        creditDays: r.credit_days,
        partyId: r.party_id,
        partyCode: r.party_code,
        partyName: r.party_name,
        partyPhone: r.party_phone,
        partyCity: r.party_city,
        invoiceAmount: grandTotal,
        paidAmount,
        returnedAmount,
        paidOrAdjustedAmount: paidOrAdjusted,
        outstandingAmount: outstanding,
        overdueDays,
        isOverdue,
        agingBucket,
        paymentStatus: effectiveStatus,
      };
    }).filter(item => {
      if (filters?.status === 'OVERDUE') return item.isOverdue;
      if (filters?.status === 'UNPAID') return item.paymentStatus === 'UNPAID';
      if (filters?.status === 'PARTIAL') return item.paymentStatus === 'PARTIAL';
      if (filters?.status === 'PAID') return item.paymentStatus === 'PAID';
      return true;
    });
  }

  /**
   * Party Chronological Statement with deterministic stable order and Opening Balance calculation
   */
  static async getPartyStatement(
    businessId: string,
    partyId: string,
    filters?: { fromDate?: string; toDate?: string; ledgerType?: 'CUSTOMER' | 'SUPPLIER' }
  ) {
    const partyRes = await pool.query(
      `SELECT * FROM parties WHERE business_id = $1 AND id = $2`,
      [businessId, partyId]
    );
    if (partyRes.rows.length === 0) throw new Error('Party not found');
    const party = partyRes.rows[0];

    const isSupplierRequested = filters?.ledgerType === 'SUPPLIER' || (party.party_type === 'SUPPLIER' && filters?.ledgerType !== 'CUSTOMER');
    const tableName = isSupplierRequested ? 'supplier_ledgers' : 'customer_ledgers';
    const partyRole = isSupplierRequested ? 'SUPPLIER' : 'CUSTOMER';

    // 1. Calculate Opening Balance strictly before fromDate
    let openingBalance = 0;
    let openingBalanceDrCr = partyRole === 'CUSTOMER' ? 'Dr' : 'Cr';

    if (filters?.fromDate) {
      const opRes = await pool.query(
        `SELECT 
           COALESCE(SUM(debit), 0) as op_debit,
           COALESCE(SUM(credit), 0) as op_credit
         FROM ${tableName}
         WHERE business_id = $1 AND party_id = $2 AND transaction_date < $3`,
        [businessId, partyId, filters.fromDate]
      );
      const opDebit = parseFloat(opRes.rows[0]?.op_debit || '0');
      const opCredit = parseFloat(opRes.rows[0]?.op_credit || '0');

      if (partyRole === 'CUSTOMER') {
        openingBalance = round2(opDebit - opCredit);
        openingBalanceDrCr = openingBalance >= 0 ? 'Dr' : 'Cr';
      } else {
        openingBalance = round2(opCredit - opDebit);
        openingBalanceDrCr = openingBalance >= 0 ? 'Cr' : 'Dr';
      }
    }

    const conditions: string[] = [`l.business_id = $1`, `l.party_id = $2`];
    const params: any[] = [businessId, partyId];
    let pIdx = 3;

    if (filters?.fromDate) {
      conditions.push(`l.transaction_date >= $${pIdx++}`);
      params.push(filters.fromDate);
    }
    if (filters?.toDate) {
      conditions.push(`l.transaction_date <= ($${pIdx++}::date + interval '1 day' - interval '1 millisecond')`);
      params.push(filters.toDate);
    }

    const whereClause = conditions.join(' AND ');

    let rowsQuery = '';
    if (partyRole === 'CUSTOMER') {
      rowsQuery = `
        SELECT 
          l.*,
          COALESCE(si.invoice_number, p.payment_number, sr.return_number, l.reference_id) as voucher_number,
          COALESCE(si.invoice_date, p.payment_date, sr.return_date, l.transaction_date) as voucher_date
        FROM customer_ledgers l
        LEFT JOIN sales_invoices si ON l.reference_type = 'SALES_INVOICE' AND si.id::text = l.reference_id
        LEFT JOIN payments p ON l.reference_type = 'PAYMENT' AND p.id::text = l.reference_id
        LEFT JOIN sales_returns sr ON l.reference_type = 'SALES_RETURN' AND sr.id::text = l.reference_id
        WHERE ${whereClause}
        ORDER BY l.transaction_date ASC, l.created_at ASC, l.id ASC
      `;
    } else {
      rowsQuery = `
        SELECT 
          l.*,
          COALESCE(pi.invoice_number, p.payment_number, pr.return_number, l.reference_id) as voucher_number,
          COALESCE(pi.invoice_date, p.payment_date, pr.return_date, l.transaction_date) as voucher_date
        FROM supplier_ledgers l
        LEFT JOIN purchase_invoices pi ON l.reference_type = 'PURCHASE_INVOICE' AND pi.id::text = l.reference_id
        LEFT JOIN payments p ON l.reference_type = 'PAYMENT' AND p.id::text = l.reference_id
        LEFT JOIN purchase_returns pr ON l.reference_type = 'PURCHASE_RETURN' AND pr.id::text = l.reference_id
        WHERE ${whereClause}
        ORDER BY l.transaction_date ASC, l.created_at ASC, l.id ASC
      `;
    }

    const rowsRes = await pool.query(rowsQuery, params);

    let runningBalance = openingBalance;
    let runningTotalDebit = 0;
    let runningTotalCredit = 0;

    const statementEntries = rowsRes.rows.map(r => {
      const debit = parseFloat(r.debit || '0');
      const credit = parseFloat(r.credit || '0');
      runningTotalDebit = round2(runningTotalDebit + debit);
      runningTotalCredit = round2(runningTotalCredit + credit);

      let balanceDrCr = 'Dr';
      if (partyRole === 'CUSTOMER') {
        runningBalance = round2(runningBalance + debit - credit);
        balanceDrCr = runningBalance >= 0 ? 'Dr' : 'Cr';
      } else {
        runningBalance = round2(runningBalance + credit - debit);
        balanceDrCr = runningBalance >= 0 ? 'Cr' : 'Dr';
      }

      const balanceAbs = Math.abs(runningBalance);

      return {
        id: r.id,
        transactionDate: r.transaction_date,
        transactionType: r.transaction_type,
        voucherType: this.getReadableVoucherType(r.transaction_type, r.reference_type, partyRole),
        voucherNumber: r.voucher_number || r.reference_id || '-',
        referenceType: r.reference_type,
        referenceId: r.reference_id,
        debit,
        credit,
        balance: balanceAbs,
        rawBalance: runningBalance,
        balanceDrCr,
        balanceFormatted: `₹${balanceAbs.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${balanceDrCr}`,
        notes: r.notes,
        createdAt: r.created_at,
      };
    });

    const closingBalanceAbs = Math.abs(runningBalance);
    const closingBalanceDrCr = partyRole === 'CUSTOMER' ? (runningBalance >= 0 ? 'Dr' : 'Cr') : (runningBalance >= 0 ? 'Cr' : 'Dr');

    return {
      party: {
        id: party.id,
        partyCode: party.party_code,
        name: party.name,
        partyType: party.party_type,
        role: partyRole,
        phone: party.mobile,
        email: party.email,
        city: party.city,
        state: party.state,
        gstin: party.gstin,
        creditLimit: party.credit_limit ? parseFloat(party.credit_limit) : 0,
        creditDays: party.credit_days ? parseInt(party.credit_days, 10) : 0,
      },
      openingBalance: Math.abs(openingBalance),
      openingBalanceRaw: openingBalance,
      openingBalanceDrCr,
      openingBalanceFormatted: `₹${Math.abs(openingBalance).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${openingBalanceDrCr}`,
      entries: statementEntries,
      summary: {
        openingBalance: Math.abs(openingBalance),
        openingBalanceDrCr,
        openingBalanceFormatted: `₹${Math.abs(openingBalance).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${openingBalanceDrCr}`,
        totalDebit: runningTotalDebit,
        totalCredit: runningTotalCredit,
        netPeriodChange: partyRole === 'CUSTOMER' ? round2(runningTotalDebit - runningTotalCredit) : round2(runningTotalCredit - runningTotalDebit),
        closingBalance: closingBalanceAbs,
        closingBalanceRaw: runningBalance,
        closingBalanceDrCr,
        closingBalanceFormatted: `₹${closingBalanceAbs.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${closingBalanceDrCr}`,
        recordsCount: statementEntries.length,
      },
    };
  }

  /**
   * Accounting Reconciliation Diagnostics Engine
   * Detects party ledger balance deviations, invoice status mismatches, and payment over-allocations
   */
  static async getAccountingReconciliation(businessId: string, partyId?: string) {
    const partyParams: any[] = [businessId];
    let partyFilter = '';
    if (partyId) {
      partyParams.push(partyId);
      partyFilter = `AND p.id = $2`;
    }

    // 1. Party Ledgers check
    const partyLedgersRes = await pool.query(
      `SELECT 
         p.id as party_id,
         p.name as party_name,
         p.party_code,
         p.party_type,
         (SELECT balance FROM customer_ledgers WHERE business_id = p.business_id AND party_id = p.id ORDER BY transaction_date DESC, created_at DESC, id DESC LIMIT 1) as cl_stored,
         (SELECT COALESCE(SUM(debit) - SUM(credit), 0) FROM customer_ledgers WHERE business_id = p.business_id AND party_id = p.id) as cl_calculated,
         (SELECT COUNT(*) FROM customer_ledgers WHERE business_id = p.business_id AND party_id = p.id) as cl_count,
         (SELECT balance FROM supplier_ledgers WHERE business_id = p.business_id AND party_id = p.id ORDER BY transaction_date DESC, created_at DESC, id DESC LIMIT 1) as sl_stored,
         (SELECT COALESCE(SUM(credit) - SUM(debit), 0) FROM supplier_ledgers WHERE business_id = p.business_id AND party_id = p.id) as sl_calculated,
         (SELECT COUNT(*) FROM supplier_ledgers WHERE business_id = p.business_id AND party_id = p.id) as sl_count
       FROM parties p
       WHERE p.business_id = $1 ${partyFilter}`,
      partyParams
    );

    const partyDiscrepancies: any[] = [];
    let reconciledPartiesCount = 0;
    let discrepantPartiesCount = 0;

    for (const r of partyLedgersRes.rows) {
      let hasDiscrepancy = false;
      const clCount = parseInt(r.cl_count, 10);
      const slCount = parseInt(r.sl_count, 10);

      if (clCount > 0) {
        const stored = parseFloat(r.cl_stored || '0');
        const calculated = parseFloat(r.cl_calculated || '0');
        const diff = round2(Math.abs(stored - calculated));
        if (diff > 0.01) {
          hasDiscrepancy = true;
          partyDiscrepancies.push({
            partyId: r.party_id,
            partyName: r.party_name,
            partyCode: r.party_code,
            partyType: r.party_type,
            ledgerType: 'CUSTOMER',
            storedBalance: stored,
            calculatedBalance: calculated,
            discrepancy: round2(stored - calculated),
            issue: `Customer Ledger stored balance (₹${stored.toFixed(2)}) diverges from sum of debits minus credits (₹${calculated.toFixed(2)}).`,
          });
        }
      }

      if (slCount > 0) {
        const stored = parseFloat(r.sl_stored || '0');
        const calculated = parseFloat(r.sl_calculated || '0');
        const diff = round2(Math.abs(stored - calculated));
        if (diff > 0.01) {
          hasDiscrepancy = true;
          partyDiscrepancies.push({
            partyId: r.party_id,
            partyName: r.party_name,
            partyCode: r.party_code,
            partyType: r.party_type,
            ledgerType: 'SUPPLIER',
            storedBalance: stored,
            calculatedBalance: calculated,
            discrepancy: round2(stored - calculated),
            issue: `Supplier Ledger stored balance (₹${stored.toFixed(2)}) diverges from sum of credits minus debits (₹${calculated.toFixed(2)}).`,
          });
        }
      }

      if (!hasDiscrepancy && (clCount > 0 || slCount > 0)) {
        reconciledPartiesCount++;
      } else if (hasDiscrepancy) {
        discrepantPartiesCount++;
      }
    }

    // 2. Invoice payment_status integrity check
    const invoiceDiscrepancies: any[] = [];
    const salesInvsRes = await pool.query(
      `SELECT 
         si.id, si.invoice_number, si.grand_total, si.payment_status,
         COALESCE(SUM(CASE WHEN pa.status = 'ACTIVE' AND p.status = 'POSTED' THEN pa.allocated_amount ELSE 0 END), 0) as paid_amount,
         COALESCE(sr.returns_total, 0) as returned_amount
       FROM sales_invoices si
       LEFT JOIN payment_allocations pa ON pa.document_id = si.id AND pa.business_id = si.business_id
       LEFT JOIN payments p ON p.id = pa.payment_id
       LEFT JOIN (
         SELECT sales_invoice_id, SUM(grand_total) as returns_total 
         FROM sales_returns WHERE business_id = $1 AND status = 'POSTED' 
         GROUP BY sales_invoice_id
       ) sr ON sr.sales_invoice_id = si.id
       WHERE si.business_id = $1 AND si.status = 'POSTED'
       GROUP BY si.id, si.invoice_number, si.grand_total, si.payment_status, sr.returns_total`,
      [businessId]
    );

    for (const inv of salesInvsRes.rows) {
      const grandTotal = parseFloat(inv.grand_total);
      const paid = parseFloat(inv.paid_amount);
      const returned = parseFloat(inv.returned_amount);
      const adjusted = round2(paid + returned);
      const outstanding = round2(Math.max(0, grandTotal - adjusted));

      let expectedStatus = 'UNPAID';
      if (outstanding <= 0.001) expectedStatus = 'PAID';
      else if (adjusted > 0.001) expectedStatus = 'PARTIAL';

      if (inv.payment_status !== expectedStatus) {
        invoiceDiscrepancies.push({
          invoiceId: inv.id,
          invoiceNumber: inv.invoice_number,
          documentType: 'SALES_INVOICE',
          grandTotal,
          paidAmount: paid,
          returnedAmount: returned,
          outstandingAmount: outstanding,
          currentStatus: inv.payment_status,
          expectedStatus,
          issue: `Invoice ${inv.invoice_number} has status '${inv.payment_status}' but calculated status is '${expectedStatus}' (Outstanding: ₹${outstanding.toFixed(2)}).`,
        });
      }
    }

    const purchaseInvsRes = await pool.query(
      `SELECT 
         pi.id, pi.invoice_number, pi.grand_total, pi.payment_status,
         COALESCE(SUM(CASE WHEN pa.status = 'ACTIVE' AND p.status = 'POSTED' THEN pa.allocated_amount ELSE 0 END), 0) as paid_amount,
         COALESCE(pr.returns_total, 0) as returned_amount
       FROM purchase_invoices pi
       LEFT JOIN payment_allocations pa ON pa.document_id = pi.id AND pa.business_id = pi.business_id
       LEFT JOIN payments p ON p.id = pa.payment_id
       LEFT JOIN (
         SELECT purchase_invoice_id, SUM(grand_total) as returns_total 
         FROM purchase_returns WHERE business_id = $1 AND status = 'POSTED' 
         GROUP BY purchase_invoice_id
       ) pr ON pr.purchase_invoice_id = pi.id
       WHERE pi.business_id = $1 AND pi.status = 'POSTED'
       GROUP BY pi.id, pi.invoice_number, pi.grand_total, pi.payment_status, pr.returns_total`,
      [businessId]
    );

    for (const inv of purchaseInvsRes.rows) {
      const grandTotal = parseFloat(inv.grand_total);
      const paid = parseFloat(inv.paid_amount);
      const returned = parseFloat(inv.returned_amount);
      const adjusted = round2(paid + returned);
      const outstanding = round2(Math.max(0, grandTotal - adjusted));

      let expectedStatus = 'UNPAID';
      if (outstanding <= 0.001) expectedStatus = 'PAID';
      else if (adjusted > 0.001) expectedStatus = 'PARTIAL';

      if (inv.payment_status !== expectedStatus) {
        invoiceDiscrepancies.push({
          invoiceId: inv.id,
          invoiceNumber: inv.invoice_number,
          documentType: 'PURCHASE_INVOICE',
          grandTotal,
          paidAmount: paid,
          returnedAmount: returned,
          outstandingAmount: outstanding,
          currentStatus: inv.payment_status,
          expectedStatus,
          issue: `Purchase bill ${inv.invoice_number} has status '${inv.payment_status}' but calculated status is '${expectedStatus}' (Outstanding: ₹${outstanding.toFixed(2)}).`,
        });
      }
    }

    // 3. Payment over-allocation & unallocated balance check
    const paymentDiscrepancies: any[] = [];
    const paymentsRes = await pool.query(
      `SELECT 
         p.id, p.payment_number, p.payment_type, p.amount, p.unallocated_amount, p.status,
         COALESCE(SUM(CASE WHEN pa.status = 'ACTIVE' THEN pa.allocated_amount ELSE 0 END), 0) as total_allocated
       FROM payments p
       LEFT JOIN payment_allocations pa ON pa.payment_id = p.id AND pa.business_id = p.business_id
       WHERE p.business_id = $1
       GROUP BY p.id, p.payment_number, p.payment_type, p.amount, p.unallocated_amount, p.status`,
      [businessId]
    );

    for (const p of paymentsRes.rows) {
      const amount = parseFloat(p.amount);
      const allocated = parseFloat(p.total_allocated);
      const unallocated = parseFloat(p.unallocated_amount);

      if (allocated > round2(amount + 0.001)) {
        paymentDiscrepancies.push({
          paymentId: p.id,
          paymentNumber: p.payment_number,
          paymentType: p.payment_type,
          amount,
          allocatedAmount: allocated,
          unallocatedAmount: unallocated,
          issue: `Payment ${p.payment_number} is over-allocated: Total amount ₹${amount.toFixed(2)}, Active allocated ₹${allocated.toFixed(2)}.`,
        });
      }

      const expectedUnallocated = round2(Math.max(0, amount - allocated));
      if (Math.abs(expectedUnallocated - unallocated) > 0.01) {
        paymentDiscrepancies.push({
          paymentId: p.id,
          paymentNumber: p.payment_number,
          paymentType: p.payment_type,
          amount,
          allocatedAmount: allocated,
          unallocatedAmount: unallocated,
          expectedUnallocated,
          issue: `Payment ${p.payment_number} unallocated balance mismatch: Stored ₹${unallocated.toFixed(2)}, Expected ₹${expectedUnallocated.toFixed(2)}.`,
        });
      }
    }

    const totalIssues = partyDiscrepancies.length + invoiceDiscrepancies.length + paymentDiscrepancies.length;

    return {
      success: true,
      summary: {
        totalPartiesChecked: partyLedgersRes.rows.length,
        reconciledPartiesCount,
        discrepantPartiesCount,
        totalInvoicesChecked: salesInvsRes.rows.length + purchaseInvsRes.rows.length,
        invoiceDiscrepanciesCount: invoiceDiscrepancies.length,
        totalPaymentsChecked: paymentsRes.rows.length,
        paymentDiscrepanciesCount: paymentDiscrepancies.length,
        isFullyReconciled: totalIssues === 0,
      },
      partyDiscrepancies,
      invoiceDiscrepancies,
      paymentDiscrepancies,
    };
  }

  /**
   * Synchronizes all posted invoice statuses across sales and purchases
   */
  static async syncAllInvoicePaymentStatuses(businessId: string) {
    const invs = await pool.query(
      `SELECT id FROM sales_invoices WHERE business_id = $1 AND status = 'POSTED'`,
      [businessId]
    );
    for (const row of invs.rows) {
      await this.syncSalesInvoicePaymentStatus(null, businessId, row.id);
    }
    const pinvs = await pool.query(
      `SELECT id FROM purchase_invoices WHERE business_id = $1 AND status = 'POSTED'`,
      [businessId]
    );
    for (const row of pinvs.rows) {
      await this.syncPurchaseInvoicePaymentStatus(null, businessId, row.id);
    }
  }
}
