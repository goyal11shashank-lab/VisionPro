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
  paymentDate?: string | Date;
  referenceNumber?: string;
  referenceDate?: string | Date;
  bankName?: string;
  notes?: string;
  allocations?: AllocationItemInput[];
  autoPost?: boolean;
}

export class PaymentService {
  /**
   * Generates a safe, sequential, collision-free payment number
   */
  static async generatePaymentNumber(
    businessId: string,
    paymentType: 'RECEIPT' | 'PAYMENT',
    client?: PoolClient
  ): Promise<string> {
    const executor = client || pool;
    const prefix = paymentType === 'RECEIPT' ? 'REC' : 'PAY';
    
    // Acquire a sequence count based on existing records
    const res = await executor.query(
      `SELECT COUNT(*) as count 
       FROM payments 
       WHERE business_id = $1 AND payment_type = $2`,
      [businessId, paymentType]
    );
    
    const count = parseInt(res.rows[0]?.count || '0', 10) + 1;
    let nextNum = count;
    let paymentNumber = `${prefix}-${String(nextNum).padStart(6, '0')}`;

    // Loop check for uniqueness
    while (true) {
      const check = await executor.query(
        `SELECT id FROM payments WHERE business_id = $1 AND payment_number = $2`,
        [businessId, paymentNumber]
      );
      if (check.rows.length === 0) break;
      nextNum++;
      paymentNumber = `${prefix}-${String(nextNum).padStart(6, '0')}`;
    }

    return paymentNumber;
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

          // Calculate current outstanding
          const curPaidRes = await client.query(
            `SELECT COALESCE(SUM(allocated_amount), 0) as paid 
             FROM payment_allocations 
             WHERE business_id = $1 AND document_id = $2 AND status = 'ACTIVE'`,
            [businessId, inv.id]
          );
          const currentPaid = parseFloat(curPaidRes.rows[0]?.paid || '0');
          const grandTotal = parseFloat(inv.grand_total);
          const outstanding = round2(Math.max(0, grandTotal - currentPaid));

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

          // Calculate current outstanding
          const curPaidRes = await client.query(
            `SELECT COALESCE(SUM(allocated_amount), 0) as paid 
             FROM payment_allocations 
             WHERE business_id = $1 AND document_id = $2 AND status = 'ACTIVE'`,
            [businessId, inv.id]
          );
          const currentPaid = parseFloat(curPaidRes.rows[0]?.paid || '0');
          const grandTotal = parseFloat(inv.grand_total);
          const outstanding = round2(Math.max(0, grandTotal - currentPaid));

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
      const paymentNumber = await this.generatePaymentNumber(businessId, data.paymentType, client);
      const paymentDate = data.paymentDate ? new Date(data.paymentDate) : new Date();

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

          // Calculate current paid excluding this allocation
          const otherPaidRes = await client.query(
            `SELECT COALESCE(SUM(allocated_amount), 0) as paid 
             FROM payment_allocations 
             WHERE business_id = $1 AND document_id = $2 AND status = 'ACTIVE' AND id != $3`,
            [businessId, inv.id, alloc.id]
          );
          const otherPaid = parseFloat(otherPaidRes.rows[0]?.paid || '0');
          const grandTotal = parseFloat(inv.grand_total);
          const outstanding = round2(Math.max(0, grandTotal - otherPaid));

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

          // Calculate current paid excluding this allocation
          const otherPaidRes = await client.query(
            `SELECT COALESCE(SUM(allocated_amount), 0) as paid 
             FROM payment_allocations 
             WHERE business_id = $1 AND document_id = $2 AND status = 'ACTIVE' AND id != $3`,
            [businessId, inv.id, alloc.id]
          );
          const otherPaid = parseFloat(otherPaidRes.rows[0]?.paid || '0');
          const grandTotal = parseFloat(inv.grand_total);
          const outstanding = round2(Math.max(0, grandTotal - otherPaid));

          if (allocAmt > round2(outstanding + 0.001)) {
            throw new Error(`Allocated amount (${allocAmt.toFixed(2)}) exceeds purchase bill ${inv.invoice_number} outstanding of ${outstanding.toFixed(2)}`);
          }
        }
      }

      // 3. Update Ledgers
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
            '0.00', $4, $5, $6, $7, $8, NOW()
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

      // 4. Update Payment Master status
      await client.query(
        `UPDATE payments 
         SET status = 'POSTED', updated_at = NOW(), updated_by = $1 
         WHERE id = $2`,
        [userId || null, paymentId]
      );

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
   * Synchronizes payment_status on Sales Invoice
   */
  private static async syncSalesInvoicePaymentStatus(client: PoolClient, businessId: string, invoiceId: string) {
    const invRes = await client.query(
      `SELECT grand_total FROM sales_invoices WHERE business_id = $1 AND id = $2`,
      [businessId, invoiceId]
    );
    if (invRes.rows.length === 0) return;
    const grandTotal = parseFloat(invRes.rows[0].grand_total);

    const paidRes = await client.query(
      `SELECT COALESCE(SUM(pa.allocated_amount), 0) as paid 
       FROM payment_allocations pa
       JOIN payments p ON p.id = pa.payment_id
       WHERE pa.business_id = $1 AND pa.document_id = $2 
         AND pa.status = 'ACTIVE' AND p.status = 'POSTED'`,
      [businessId, invoiceId]
    );
    const totalPaid = parseFloat(paidRes.rows[0]?.paid || '0');

    let newStatus = 'UNPAID';
    if (totalPaid >= round2(grandTotal - 0.001)) {
      newStatus = 'PAID';
    } else if (totalPaid > 0.001) {
      newStatus = 'PARTIAL';
    }

    await client.query(
      `UPDATE sales_invoices SET payment_status = $1, updated_at = NOW() WHERE id = $2`,
      [newStatus, invoiceId]
    );
  }

  /**
   * Synchronizes payment_status on Purchase Invoice
   */
  private static async syncPurchaseInvoicePaymentStatus(client: PoolClient, businessId: string, invoiceId: string) {
    const invRes = await client.query(
      `SELECT grand_total FROM purchase_invoices WHERE business_id = $1 AND id = $2`,
      [businessId, invoiceId]
    );
    if (invRes.rows.length === 0) return;
    const grandTotal = parseFloat(invRes.rows[0].grand_total);

    const paidRes = await client.query(
      `SELECT COALESCE(SUM(pa.allocated_amount), 0) as paid 
       FROM payment_allocations pa
       JOIN payments p ON p.id = pa.payment_id
       WHERE pa.business_id = $1 AND pa.document_id = $2 
         AND pa.status = 'ACTIVE' AND p.status = 'POSTED'`,
      [businessId, invoiceId]
    );
    const totalPaid = parseFloat(paidRes.rows[0]?.paid || '0');

    let newStatus = 'UNPAID';
    if (totalPaid >= round2(grandTotal - 0.001)) {
      newStatus = 'PAID';
    } else if (totalPaid > 0.001) {
      newStatus = 'PARTIAL';
    }

    await client.query(
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

          // Outstanding check
          const paidRes = await client.query(
            `SELECT COALESCE(SUM(allocated_amount), 0) as paid 
             FROM payment_allocations 
             WHERE business_id = $1 AND document_id = $2 AND status = 'ACTIVE'`,
            [businessId, inv.id]
          );
          const currentPaid = parseFloat(paidRes.rows[0]?.paid || '0');
          const outstanding = round2(Math.max(0, parseFloat(inv.grand_total) - currentPaid));

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

          // Outstanding check
          const paidRes = await client.query(
            `SELECT COALESCE(SUM(allocated_amount), 0) as paid 
             FROM payment_allocations 
             WHERE business_id = $1 AND document_id = $2 AND status = 'ACTIVE'`,
            [businessId, inv.id]
          );
          const currentPaid = parseFloat(paidRes.rows[0]?.paid || '0');
          const outstanding = round2(Math.max(0, parseFloat(inv.grand_total) - currentPaid));

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
              $4, '0.00', $5, NOW(), $6, $7, NOW()
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
          '0.00', $4, $5, NOW(), $6, $7, NOW()
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
           COALESCE(SUM(CASE WHEN pa.status = 'ACTIVE' AND p.status = 'POSTED' THEN pa.allocated_amount ELSE 0 END), 0) as paid_amount
         FROM sales_invoices si
         LEFT JOIN payment_allocations pa ON pa.document_id = si.id AND pa.business_id = si.business_id
         LEFT JOIN payments p ON p.id = pa.payment_id
         WHERE si.business_id = $1 AND si.party_id = $2 AND si.status = 'POSTED'
         GROUP BY si.id, si.invoice_number, si.invoice_date, si.grand_total, si.payment_status
         ORDER BY si.invoice_date ASC, si.created_at ASC`,
        [businessId, partyId]
      );

      return res.rows
        .map(r => {
          const grandTotal = parseFloat(r.grand_total);
          const paidAmount = parseFloat(r.paid_amount);
          const outstanding = round2(Math.max(0, grandTotal - paidAmount));
          return {
            id: r.id,
            documentNumber: r.document_number,
            documentDate: r.document_date,
            documentType: r.document_type,
            grandTotal,
            paidAmount,
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
           COALESCE(SUM(CASE WHEN pa.status = 'ACTIVE' AND p.status = 'POSTED' THEN pa.allocated_amount ELSE 0 END), 0) as paid_amount
         FROM purchase_invoices pi
         LEFT JOIN payment_allocations pa ON pa.document_id = pi.id AND pa.business_id = pi.business_id
         LEFT JOIN payments p ON p.id = pa.payment_id
         WHERE pi.business_id = $1 AND pi.supplier_party_id = $2 AND pi.status = 'POSTED'
         GROUP BY pi.id, pi.invoice_number, pi.invoice_date, pi.grand_total, pi.payment_status
         ORDER BY pi.invoice_date ASC, pi.created_at ASC`,
        [businessId, partyId]
      );

      return res.rows
        .map(r => {
          const grandTotal = parseFloat(r.grand_total);
          const paidAmount = parseFloat(r.paid_amount);
          const outstanding = round2(Math.max(0, grandTotal - paidAmount));
          return {
            id: r.id,
            documentNumber: r.document_number,
            documentDate: r.document_date,
            documentType: r.document_type,
            grandTotal,
            paidAmount,
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
   * Customer Outstanding Overview
   */
  static async getCustomerOutstanding(businessId: string, filters?: { search?: string }) {
    const searchFilter = filters?.search ? `AND (p.name ILIKE '%${filters.search}%' OR p.mobile ILIKE '%${filters.search}%')` : '';

    const query = `
      WITH LatestLedger AS (
        SELECT DISTINCT ON (party_id) party_id, balance, transaction_date
        FROM customer_ledgers
        WHERE business_id = $1
        ORDER BY party_id, transaction_date DESC, created_at DESC
      ),
      UnpaidInvoices AS (
        SELECT 
          si.party_id,
          COUNT(si.id) as unpaid_count,
          MIN(si.invoice_date) as oldest_invoice_date,
          SUM(si.grand_total - COALESCE(pa.paid, 0)) as total_unpaid_amount
        FROM sales_invoices si
        LEFT JOIN (
          SELECT document_id, SUM(allocated_amount) as paid
          FROM payment_allocations
          WHERE business_id = $1 AND status = 'ACTIVE'
          GROUP BY document_id
        ) pa ON pa.document_id = si.id
        WHERE si.business_id = $1 AND si.status = 'POSTED' AND (si.payment_status != 'PAID' OR si.payment_status IS NULL)
        GROUP BY si.party_id
      )
      SELECT 
        p.id as party_id,
        p.name as party_name,
        p.mobile as phone,
        p.email,
        p.credit_limit,
        COALESCE(ll.balance, '0.00') as current_balance,
        COALESCE(ui.unpaid_count, 0) as unpaid_invoices_count,
        ui.oldest_invoice_date,
        COALESCE(ui.total_unpaid_amount, 0) as total_unpaid_amount
      FROM parties p
      LEFT JOIN LatestLedger ll ON ll.party_id = p.id
      LEFT JOIN UnpaidInvoices ui ON ui.party_id = p.id
      WHERE p.business_id = $1 
        AND p.party_type IN ('CUSTOMER', 'BOTH')
        ${searchFilter}
      ORDER BY COALESCE(ll.balance::numeric, 0) DESC, p.name ASC
    `;

    const res = await pool.query(query, [businessId]);
    return res.rows.map(r => ({
      partyId: r.party_id,
      partyName: r.party_name,
      phone: r.phone,
      email: r.email,
      creditLimit: r.credit_limit ? parseFloat(r.credit_limit) : 0,
      currentBalance: parseFloat(r.current_balance),
      unpaidInvoicesCount: parseInt(r.unpaid_invoices_count, 10),
      oldestInvoiceDate: r.oldest_invoice_date,
      totalUnpaidAmount: parseFloat(r.total_unpaid_amount),
    }));
  }

  /**
   * Supplier Outstanding Overview
   */
  static async getSupplierOutstanding(businessId: string, filters?: { search?: string }) {
    const searchFilter = filters?.search ? `AND (p.name ILIKE '%${filters.search}%' OR p.mobile ILIKE '%${filters.search}%')` : '';

    const query = `
      WITH LatestLedger AS (
        SELECT DISTINCT ON (party_id) party_id, balance, transaction_date
        FROM supplier_ledgers
        WHERE business_id = $1
        ORDER BY party_id, transaction_date DESC, created_at DESC
      ),
      UnpaidBills AS (
        SELECT 
          pi.supplier_party_id as party_id,
          COUNT(pi.id) as unpaid_count,
          MIN(pi.invoice_date) as oldest_bill_date,
          SUM(pi.grand_total - COALESCE(pa.paid, 0)) as total_unpaid_amount
        FROM purchase_invoices pi
        LEFT JOIN (
          SELECT document_id, SUM(allocated_amount) as paid
          FROM payment_allocations
          WHERE business_id = $1 AND status = 'ACTIVE'
          GROUP BY document_id
        ) pa ON pa.document_id = pi.id
        WHERE pi.business_id = $1 AND pi.status = 'POSTED' AND (pi.payment_status != 'PAID' OR pi.payment_status IS NULL)
        GROUP BY pi.supplier_party_id
      )
      SELECT 
        p.id as party_id,
        p.name as party_name,
        p.mobile as phone,
        p.email,
        COALESCE(ll.balance, '0.00') as current_balance,
        COALESCE(ub.unpaid_count, 0) as unpaid_bills_count,
        ub.oldest_bill_date,
        COALESCE(ub.total_unpaid_amount, 0) as total_unpaid_amount
      FROM parties p
      LEFT JOIN LatestLedger ll ON ll.party_id = p.id
      LEFT JOIN UnpaidBills ub ON ub.party_id = p.id
      WHERE p.business_id = $1 
        AND p.party_type IN ('SUPPLIER', 'BOTH')
        ${searchFilter}
      ORDER BY COALESCE(ll.balance::numeric, 0) DESC, p.name ASC
    `;

    const res = await pool.query(query, [businessId]);
    return res.rows.map(r => ({
      partyId: r.party_id,
      partyName: r.party_name,
      phone: r.phone,
      email: r.email,
      currentBalance: parseFloat(r.current_balance),
      unpaidBillsCount: parseInt(r.unpaid_bills_count, 10),
      oldestBillDate: r.oldest_bill_date,
      totalUnpaidAmount: parseFloat(r.total_unpaid_amount),
    }));
  }

  /**
   * Party Chronological Statement
   */
  static async getPartyStatement(
    businessId: string,
    partyId: string,
    filters?: { fromDate?: string; toDate?: string }
  ) {
    const partyRes = await pool.query(
      `SELECT * FROM parties WHERE business_id = $1 AND id = $2`,
      [businessId, partyId]
    );
    if (partyRes.rows.length === 0) throw new Error('Party not found');
    const party = partyRes.rows[0];

    const isCustomer = party.party_type === 'CUSTOMER' || party.party_type === 'BOTH';
    const tableName = isCustomer ? 'customer_ledgers' : 'supplier_ledgers';

    const conditions: string[] = [`business_id = $1`, `party_id = $2`];
    const params: any[] = [businessId, partyId];
    let pIdx = 3;

    if (filters?.fromDate) {
      conditions.push(`transaction_date >= $${pIdx++}`);
      params.push(filters.fromDate);
    }
    if (filters?.toDate) {
      conditions.push(`transaction_date <= $${pIdx++}`);
      params.push(filters.toDate);
    }

    const whereClause = conditions.join(' AND ');

    const rowsRes = await pool.query(
      `SELECT * FROM ${tableName}
       WHERE ${whereClause}
       ORDER BY transaction_date ASC, created_at ASC`,
      params
    );

    let runningTotalDebit = 0;
    let runningTotalCredit = 0;

    const statementEntries = rowsRes.rows.map(r => {
      const debit = parseFloat(r.debit || '0');
      const credit = parseFloat(r.credit || '0');
      const balance = parseFloat(r.balance || '0');
      runningTotalDebit = round2(runningTotalDebit + debit);
      runningTotalCredit = round2(runningTotalCredit + credit);

      return {
        id: r.id,
        transactionDate: r.transaction_date,
        transactionType: r.transaction_type,
        referenceType: r.reference_type,
        referenceId: r.reference_id,
        debit,
        credit,
        balance,
        notes: r.notes,
        createdAt: r.created_at,
      };
    });

    const closingBalance = statementEntries.length > 0 ? statementEntries[statementEntries.length - 1].balance : 0;

    return {
      party: {
        id: party.id,
        name: party.name,
        partyType: party.party_type,
        phone: party.mobile,
        email: party.email,
        gstin: party.gstin,
      },
      entries: statementEntries,
      summary: {
        totalDebit: runningTotalDebit,
        totalCredit: runningTotalCredit,
        closingBalance,
        recordsCount: statementEntries.length,
      },
    };
  }
}
