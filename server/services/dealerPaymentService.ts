import { pool } from '../db/index.js';
import { PaymentService } from './paymentService.js';
import { DealerDashboardService } from './dealerDashboardService.js';
import { DealerControlService } from './dealerControlService.js';
import { AuditService } from './auditService.js';

function round2(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

export interface SubmitDealerPaymentInput {
  paymentDate: string;
  paymentMode: 'BANK_TRANSFER' | 'UPI' | 'CHEQUE' | 'CASH' | 'OTHER';
  amount: number;
  referenceNumber?: string;
  bankName?: string;
  chequeNumber?: string;
  chequeDate?: string;
  notes?: string;
  allocations: Array<{
    dealerPurchaseInvoiceId: string;
    allocatedAmount: number;
    notes?: string;
  }>;
}

export interface DealerUnpaidInvoiceItem {
  id: string;
  invoiceNumber: string;
  supplierInvoiceNumber: string | null;
  invoiceDate: string;
  dueDate: string | null;
  grandTotal: number;
  paidAmount: number;
  outstandingAmount: number;
  mainSalesInvoiceId: string | null;
  mainSalesInvoiceNumber: string | null;
  daysOverdue: number;
}

export class DealerPaymentService {
  /**
   * Helper: Generate unique Payment Advice number: ADV-YYYYMM-XXXXX
   */
  static async generateAdviceNumber(client: any, dealerBusinessId: string): Promise<string> {
    const now = new Date();
    const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const prefix = `ADV-${yearMonth}-`;

    const seqRes = await client.query(
      `SELECT advice_number FROM dealer_payment_advices
       WHERE dealer_business_id = $1 AND advice_number LIKE $2
       ORDER BY advice_number DESC LIMIT 1 FOR UPDATE`,
      [dealerBusinessId, `${prefix}%`]
    );

    let nextNum = 1;
    if (seqRes.rows.length > 0) {
      const last = seqRes.rows[0].advice_number;
      const parts = last.split('-');
      if (parts.length >= 3) {
        const parsed = parseInt(parts[2], 10);
        if (!isNaN(parsed)) nextNum = parsed + 1;
      }
    }

    return `${prefix}${String(nextNum).padStart(5, '0')}`;
  }

  /**
   * Helper: Resolve Main Sales Invoice for a Dealer Purchase Invoice
   * 3-tier lookup using cross-business GRN -> Shipment linkage, PO linkage, or Invoice Number match.
   */
  static async resolveMainSalesInvoice(client: any, dealerPurchaseInvoiceId: string, mainBusinessId: string): Promise<{ id: string; invoiceNumber: string } | null> {
    // Tier 1: dealer_goods_receipts -> dealer_shipments -> main_sales_invoice_id
    const grRes = await client.query(
      `SELECT ds.main_sales_invoice_id, si.invoice_number
       FROM dealer_goods_receipts gr
       JOIN dealer_shipments ds ON gr.dealer_shipment_id = ds.id
       JOIN sales_invoices si ON ds.main_sales_invoice_id = si.id
       WHERE gr.dealer_purchase_invoice_id = $1 AND ds.main_business_id = $2
       LIMIT 1`,
      [dealerPurchaseInvoiceId, mainBusinessId]
    );
    if (grRes.rows.length > 0 && grRes.rows[0].main_sales_invoice_id) {
      return {
        id: grRes.rows[0].main_sales_invoice_id,
        invoiceNumber: grRes.rows[0].invoice_number,
      };
    }

    // Tier 2: purchase_invoices -> purchase_orders.main_sales_invoice_id
    const poRes = await client.query(
      `SELECT po.main_sales_invoice_id, si.invoice_number
       FROM purchase_invoices pi
       JOIN purchase_orders po ON pi.purchase_order_id = po.id
       JOIN sales_invoices si ON po.main_sales_invoice_id = si.id
       WHERE pi.id = $1 AND si.business_id = $2
       LIMIT 1`,
      [dealerPurchaseInvoiceId, mainBusinessId]
    );
    if (poRes.rows.length > 0 && poRes.rows[0].main_sales_invoice_id) {
      return {
        id: poRes.rows[0].main_sales_invoice_id,
        invoiceNumber: poRes.rows[0].invoice_number,
      };
    }

    // Tier 3: purchase_invoices.supplier_invoice_number matches sales_invoices.invoice_number
    const numRes = await client.query(
      `SELECT si.id, si.invoice_number
       FROM purchase_invoices pi
       JOIN sales_invoices si ON si.business_id = $2 AND si.invoice_number = pi.supplier_invoice_number
       WHERE pi.id = $1
       LIMIT 1`,
      [dealerPurchaseInvoiceId, mainBusinessId]
    );
    if (numRes.rows.length > 0) {
      return {
        id: numRes.rows[0].id,
        invoiceNumber: numRes.rows[0].invoice_number,
      };
    }

    return null;
  }

  /**
   * 1. GET Unpaid Invoices for Dealer against Main Warehouse
   */
  static async getDealerUnpaidInvoices(dealerBusinessId: string) {
    const client = await pool.connect();
    try {
      const { dealerBiz, mainWarehouse } = await DealerDashboardService.resolveParentMainWarehouse(client, dealerBusinessId);
      const mainSupplierPartyId = await DealerDashboardService.resolveMainWarehouseSupplierParty(client, dealerBusinessId, mainWarehouse);

      if (!mainSupplierPartyId) {
        return {
          dealerBiz,
          mainWarehouse,
          mainSupplierPartyId: null,
          totalOutstanding: 0,
          pendingVerificationAmount: 0,
          invoices: [],
          pendingAdvices: [],
        };
      }

      // 1. Authoritative current balance in Supplier Ledger
      const slRes = await client.query(
        `SELECT balance FROM supplier_ledgers
         WHERE business_id = $1 AND party_id = $2
         ORDER BY created_at DESC LIMIT 1`,
        [dealerBusinessId, mainSupplierPartyId]
      );
      const totalOutstanding = slRes.rows.length > 0 ? Math.max(0, parseFloat(slRes.rows[0].balance || '0.00')) : 0;

      // 2. Fetch pending payment advices awaiting verification
      const pendingAdvRes = await client.query(
        `SELECT id, advice_number, amount, payment_date, payment_mode, reference_number, status, created_at
         FROM dealer_payment_advices
         WHERE dealer_business_id = $1 AND status = 'SUBMITTED'
         ORDER BY created_at DESC`,
        [dealerBusinessId]
      );
      const pendingAdvices = pendingAdvRes.rows.map(r => ({
        id: r.id,
        adviceNumber: r.advice_number,
        amount: parseFloat(r.amount),
        paymentDate: r.payment_date,
        paymentMode: r.payment_mode,
        referenceNumber: r.reference_number,
        status: r.status,
        createdAt: r.created_at,
      }));
      const pendingVerificationAmount = pendingAdvices.reduce((sum, a) => round2(sum + a.amount), 0);

      // 3. Fetch unpaid/partially paid Purchase Invoices
      const piRes = await client.query(
        `SELECT 
           pi.id,
           pi.invoice_number,
           pi.supplier_invoice_number,
           pi.invoice_date,
           NULL::text as due_date,
           pi.grand_total,
           (pi.grand_total - COALESCE((
             SELECT SUM(pa.allocated_amount)
             FROM payment_allocations pa
             JOIN payments pmt ON pmt.id = pa.payment_id
             WHERE pa.document_id = pi.id AND pa.status = 'ACTIVE' AND pmt.status = 'POSTED'
           ), 0) - COALESCE((
             SELECT SUM(pr.grand_total)
             FROM purchase_returns pr
             WHERE pr.purchase_invoice_id = pi.id AND pr.status = 'POSTED'
           ), 0))::numeric(12, 2) as balance,
           pi.status
         FROM purchase_invoices pi
         WHERE pi.business_id = $1 
           AND pi.supplier_party_id = $2
           AND pi.status = 'POSTED'
         ORDER BY pi.invoice_date ASC, pi.created_at ASC`,
        [dealerBusinessId, mainSupplierPartyId]
      );

      const invoices: DealerUnpaidInvoiceItem[] = [];
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      for (const row of piRes.rows) {
        const grandTotal = parseFloat(row.grand_total || '0.00');
        const balance = parseFloat(row.balance || '0.00');
        if (balance <= 0) continue;
        const paidAmount = round2(grandTotal - balance);

        let daysOverdue = 0;
        if (row.due_date) {
          const dDate = new Date(row.due_date);
          dDate.setHours(0, 0, 0, 0);
          const diffMs = today.getTime() - dDate.getTime();
          if (diffMs > 0) {
            daysOverdue = Math.floor(diffMs / (1000 * 60 * 60 * 24));
          }
        }

        // Cross-reference to Main Sales Invoice
        const linkedMainSi = await this.resolveMainSalesInvoice(client, row.id, mainWarehouse.id);

        invoices.push({
          id: row.id,
          invoiceNumber: row.invoice_number,
          supplierInvoiceNumber: row.supplier_invoice_number,
          invoiceDate: row.invoice_date,
          dueDate: row.due_date,
          grandTotal,
          paidAmount,
          outstandingAmount: balance,
          mainSalesInvoiceId: linkedMainSi ? linkedMainSi.id : null,
          mainSalesInvoiceNumber: linkedMainSi ? linkedMainSi.invoiceNumber : (row.supplier_invoice_number || null),
          daysOverdue,
        });
      }

      return {
        dealerBiz,
        mainWarehouse,
        mainSupplierPartyId,
        totalOutstanding,
        pendingVerificationAmount,
        invoices,
        pendingAdvices,
      };
    } finally {
      client.release();
    }
  }

  /**
   * 2. Duplicate Check: check if similar payment or advice already submitted
   */
  static async checkDuplicatePayment(
    dealerBusinessId: string,
    input: { amount: number; referenceNumber?: string; paymentDate?: string }
  ) {
    const client = await pool.connect();
    try {
      if (!input.referenceNumber || input.referenceNumber.trim().length < 3) {
        return { possibleDuplicate: false };
      }

      const cleanRef = input.referenceNumber.trim();
      const amountNum = round2(input.amount);

      const matchRes = await client.query(
        `SELECT id, advice_number, amount, reference_number, payment_date, status, created_at
         FROM dealer_payment_advices
         WHERE dealer_business_id = $1
           AND status IN ('SUBMITTED', 'VERIFIED')
           AND (
             LOWER(reference_number) = LOWER($2)
             OR (amount = $3 AND payment_date::date = $4::date)
           )
         ORDER BY created_at DESC LIMIT 1`,
        [dealerBusinessId, cleanRef, amountNum, input.paymentDate || new Date().toISOString()]
      );

      if (matchRes.rows.length > 0) {
        const matched = matchRes.rows[0];
        return {
          possibleDuplicate: true,
          matchedAdvice: {
            id: matched.id,
            adviceNumber: matched.advice_number,
            amount: parseFloat(matched.amount),
            referenceNumber: matched.reference_number,
            status: matched.status,
            createdAt: matched.created_at,
          },
        };
      }

      return { possibleDuplicate: false };
    } finally {
      client.release();
    }
  }

  /**
   * 3. DEALER: Submit Payment Advice
   * Creates and authoritatively posts the Supplier Payment inside Dealer business,
   * then creates the cross-business payment advice record with status 'SUBMITTED'.
   */
  static async submitDealerPaymentAdvice(
    dealerBusinessId: string,
    userId: string,
    input: SubmitDealerPaymentInput
  ) {
    const client = await pool.connect();
    try {
      const amount = round2(parseFloat(input.amount as any) || 0);
      if (amount <= 0) {
        throw new Error('Payment amount must be greater than zero.');
      }

      const { dealerBiz, mainWarehouse } = await DealerDashboardService.resolveParentMainWarehouse(client, dealerBusinessId);
      const mainSupplierPartyId = await DealerDashboardService.resolveMainWarehouseSupplierParty(client, dealerBusinessId, mainWarehouse);

      if (!mainSupplierPartyId) {
        throw new Error(`Main Warehouse Supplier Party is not configured in Dealer business.`);
      }

      // Re-validate allocations against current invoice balances
      const allocations = input.allocations || [];
      let totalAllocated = 0;
      for (const a of allocations) {
        const aAmt = round2(parseFloat(a.allocatedAmount as any) || 0);
        if (aAmt < 0) {
          throw new Error('Allocation amount cannot be negative.');
        }
        totalAllocated = round2(totalAllocated + aAmt);
      }

      if (totalAllocated > round2(amount + 0.01)) {
        throw new Error(`Total invoice allocations (₹${totalAllocated.toFixed(2)}) cannot exceed payment amount (₹${amount.toFixed(2)}).`);
      }

      const unallocatedAmount = round2(amount - totalAllocated);

      // Verify each invoice belongs to dealer and supplier
      const mappedProposedAllocations: any[] = [];
      const paymentAllocationsInput: any[] = [];

      for (const a of allocations) {
        const aAmt = round2(parseFloat(a.allocatedAmount as any) || 0);
        if (aAmt <= 0) continue;

        const invRes = await client.query(
          `SELECT id, invoice_number, supplier_invoice_number, grand_total,
                  (grand_total - COALESCE((
                    SELECT SUM(pa.allocated_amount)
                    FROM payment_allocations pa
                    JOIN payments pmt ON pmt.id = pa.payment_id
                    WHERE pa.document_id = purchase_invoices.id AND pa.status = 'ACTIVE' AND pmt.status = 'POSTED'
                  ), 0) - COALESCE((
                    SELECT SUM(pr.grand_total)
                    FROM purchase_returns pr
                    WHERE pr.purchase_invoice_id = purchase_invoices.id AND pr.status = 'POSTED'
                  ), 0))::numeric(12, 2) as balance
           FROM purchase_invoices
           WHERE id = $1 AND business_id = $2 AND supplier_party_id = $3 FOR UPDATE`,
          [a.dealerPurchaseInvoiceId, dealerBusinessId, mainSupplierPartyId]
        );

        if (invRes.rows.length === 0) {
          throw new Error(`Purchase Invoice '${a.dealerPurchaseInvoiceId}' not found or does not belong to Main Warehouse.`);
        }

        const inv = invRes.rows[0];
        const currentBalance = parseFloat(inv.balance || '0.00');
        if (aAmt > round2(currentBalance + 0.01)) {
          throw new Error(`Allocated amount ₹${aAmt.toFixed(2)} exceeds current outstanding balance ₹${currentBalance.toFixed(2)} for invoice ${inv.invoice_number}.`);
        }

        // Cross-reference corresponding Main Sales Invoice
        const linkedMainSi = await this.resolveMainSalesInvoice(client, inv.id, mainWarehouse.id);

        mappedProposedAllocations.push({
          dealerPurchaseInvoiceId: inv.id,
          dealerPurchaseInvoiceNumber: inv.invoice_number,
          mainSalesInvoiceId: linkedMainSi ? linkedMainSi.id : null,
          mainSalesInvoiceNumber: linkedMainSi ? linkedMainSi.invoiceNumber : (inv.supplier_invoice_number || null),
          allocatedAmount: aAmt,
          outstandingBefore: currentBalance,
          notes: a.notes || '',
        });

        paymentAllocationsInput.push({
          documentType: 'PURCHASE_INVOICE',
          documentId: inv.id,
          allocatedAmount: aAmt,
          notes: a.notes || `Payment advice to Main Warehouse ${mainWarehouse.name}`,
        });
      }

      // 1. Create and authoritatively post Supplier Payment in Dealer Business
      // This uses the existing accounting engine to update Supplier Ledger and Purchase Invoices
      const paymentModeForAccounting = (
        input.paymentMode === 'BANK_TRANSFER' ? 'BANK' : input.paymentMode
      ) as 'CASH' | 'BANK' | 'UPI' | 'CHEQUE' | 'OTHER';

      const supplierPayment = await PaymentService.createPayment(
        dealerBusinessId,
        {
          paymentType: 'PAYMENT',
          partyId: mainSupplierPartyId,
          paymentDate: input.paymentDate || new Date().toISOString(),
          paymentMode: paymentModeForAccounting,
          amount,
          referenceNumber: input.referenceNumber || input.chequeNumber || '',
          referenceDate: input.chequeDate || undefined,
          bankName: input.bankName || '',
          notes: `Payment Advice to Main Warehouse (${mainWarehouse.name}). ${input.notes || ''}`.trim(),
          allocations: paymentAllocationsInput,
          autoPost: true,
        },
        userId
      );

      // 2. Generate Payment Advice Number
      const adviceNumber = await this.generateAdviceNumber(client, dealerBusinessId);

      // 3. Insert record into dealer_payment_advices
      const adviceRes = await client.query(
        `INSERT INTO dealer_payment_advices (
           advice_number,
           dealer_business_id,
           main_business_id,
           dealer_supplier_payment_id,
           amount,
           payment_date,
           payment_mode,
           reference_number,
           bank_name,
           cheque_number,
           cheque_date,
           notes,
           proposed_allocations,
           status,
           submitted_by,
           submitted_at,
           created_at,
           updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'SUBMITTED', $14, NOW(), NOW(), NOW()
         ) RETURNING *`,
        [
          adviceNumber,
          dealerBusinessId,
          mainWarehouse.id,
          supplierPayment.id,
          amount.toFixed(2),
          input.paymentDate || new Date().toISOString(),
          input.paymentMode,
          input.referenceNumber || null,
          input.bankName || null,
          input.chequeNumber || null,
          input.chequeDate || null,
          input.notes || null,
          JSON.stringify(mappedProposedAllocations),
          userId || null,
        ]
      );

      const advice = adviceRes.rows[0];

      // 4. Audit Log
      await AuditService.log({
        businessId: dealerBusinessId,
        userId,
        module: 'dealers',
        action: 'SUBMIT_PAYMENT_ADVICE',
        entityType: 'dealer_payment_advice',
        entityId: advice.id,
        newValue: {
          adviceNumber,
          amount,
          paymentMode: input.paymentMode,
          referenceNumber: input.referenceNumber,
          supplierPaymentId: supplierPayment.id,
          unallocatedAmount,
        },
      });

      return {
        success: true,
        adviceId: advice.id,
        adviceNumber,
        dealerSupplierPaymentId: supplierPayment.id,
        dealerPaymentNumber: supplierPayment.payment_number,
        amount,
        unallocatedAmount,
        status: 'SUBMITTED',
      };
    } finally {
      client.release();
    }
  }

  /**
   * 4. List Payment Advices (shared for Dealer & Main)
   */
  static async getPaymentAdvices(
    businessId: string,
    isMain: boolean,
    filters: {
      dealerBusinessId?: string;
      status?: string;
      fromDate?: string;
      toDate?: string;
      search?: string;
      page?: number;
      limit?: number;
    } = {}
  ) {
    const client = await pool.connect();
    try {
      const page = Math.max(1, Number(filters.page) || 1);
      const limit = Math.min(200, Math.max(1, Number(filters.limit) || 50));
      const offset = (page - 1) * limit;

      const conditions: string[] = [];
      const params: any[] = [];
      let paramIdx = 1;

      if (isMain) {
        conditions.push(`dpa.main_business_id = $${paramIdx++}`);
        params.push(businessId);
        if (filters.dealerBusinessId) {
          conditions.push(`dpa.dealer_business_id = $${paramIdx++}`);
          params.push(filters.dealerBusinessId);
        }
      } else {
        conditions.push(`dpa.dealer_business_id = $${paramIdx++}`);
        params.push(businessId);
      }

      if (filters.status && filters.status !== 'ALL') {
        conditions.push(`dpa.status = $${paramIdx++}`);
        params.push(filters.status);
      }

      if (filters.fromDate) {
        conditions.push(`dpa.payment_date >= $${paramIdx++}::timestamp`);
        params.push(filters.fromDate);
      }

      if (filters.toDate) {
        conditions.push(`dpa.payment_date <= $${paramIdx++}::timestamp`);
        params.push(`${filters.toDate} 23:59:59`);
      }

      if (filters.search) {
        const q = `%${filters.search.trim().toLowerCase()}%`;
        conditions.push(`(
          LOWER(dpa.advice_number) LIKE $${paramIdx}
          OR LOWER(COALESCE(dpa.reference_number, '')) LIKE $${paramIdx}
          OR LOWER(COALESCE(db.name, '')) LIKE $${paramIdx}
          OR LOWER(COALESCE(dp.payment_number, '')) LIKE $${paramIdx}
          OR LOWER(COALESCE(mr.payment_number, '')) LIKE $${paramIdx}
        )`);
        params.push(q);
        paramIdx++;
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      // Count query
      const countRes = await client.query(
        `SELECT COUNT(*) as total,
                COALESCE(SUM(dpa.amount), 0)::numeric(12, 2) as total_amount,
                COUNT(*) FILTER (WHERE dpa.status = 'SUBMITTED')::int as submitted_count,
                COALESCE(SUM(dpa.amount) FILTER (WHERE dpa.status = 'SUBMITTED'), 0)::numeric(12, 2) as submitted_amount,
                COUNT(*) FILTER (WHERE dpa.status = 'VERIFIED')::int as verified_count,
                COALESCE(SUM(dpa.amount) FILTER (WHERE dpa.status = 'VERIFIED'), 0)::numeric(12, 2) as verified_amount,
                COUNT(*) FILTER (WHERE dpa.status = 'REJECTED')::int as rejected_count
         FROM dealer_payment_advices dpa
         JOIN businesses db ON dpa.dealer_business_id = db.id
         LEFT JOIN payments dp ON dpa.dealer_supplier_payment_id = dp.id
         LEFT JOIN payments mr ON dpa.main_customer_receipt_id = mr.id
         ${whereClause}`,
        params
      );

      const stats = {
        total: parseInt(countRes.rows[0]?.total || '0', 10),
        totalAmount: parseFloat(countRes.rows[0]?.total_amount || '0.00'),
        submittedCount: countRes.rows[0]?.submitted_count || 0,
        submittedAmount: parseFloat(countRes.rows[0]?.submitted_amount || '0.00'),
        verifiedCount: countRes.rows[0]?.verified_count || 0,
        verifiedAmount: parseFloat(countRes.rows[0]?.verified_amount || '0.00'),
        rejectedCount: countRes.rows[0]?.rejected_count || 0,
      };

      // Query data
      const dataRes = await client.query(
        `SELECT 
           dpa.id,
           dpa.advice_number,
           dpa.dealer_business_id,
           dpa.main_business_id,
           dpa.dealer_supplier_payment_id,
           dpa.main_customer_receipt_id,
           dpa.amount,
           dpa.payment_date,
           dpa.payment_mode,
           dpa.reference_number,
           dpa.bank_name,
           dpa.cheque_number,
           dpa.cheque_date,
           dpa.notes,
           dpa.proposed_allocations,
           dpa.status,
           dpa.submitted_by,
           dpa.submitted_at,
           dpa.verified_by,
           dpa.verified_at,
           dpa.rejected_by,
           dpa.rejected_at,
           dpa.rejection_reason,
           dpa.created_at,
           db.name as dealer_name,
           db.trade_name as dealer_trade_name,
           mb.name as main_name,
           dp.payment_number as dealer_payment_number,
           mr.payment_number as main_receipt_number,
           sub_u.full_name as submitted_by_name,
           ver_u.full_name as verified_by_name,
           rej_u.full_name as rejected_by_name
         FROM dealer_payment_advices dpa
         JOIN businesses db ON dpa.dealer_business_id = db.id
         JOIN businesses mb ON dpa.main_business_id = mb.id
         LEFT JOIN payments dp ON dpa.dealer_supplier_payment_id = dp.id
         LEFT JOIN payments mr ON dpa.main_customer_receipt_id = mr.id
         LEFT JOIN users sub_u ON dpa.submitted_by = sub_u.id
         LEFT JOIN users ver_u ON dpa.verified_by = ver_u.id
         LEFT JOIN users rej_u ON dpa.rejected_by = rej_u.id
         ${whereClause}
         ORDER BY dpa.created_at DESC
         LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
        [...params, limit, offset]
      );

      const advices = dataRes.rows.map(r => ({
        id: r.id,
        adviceNumber: r.advice_number,
        dealerBusinessId: r.dealer_business_id,
        mainBusinessId: r.main_business_id,
        dealerSupplierPaymentId: r.dealer_supplier_payment_id,
        mainCustomerReceiptId: r.main_customer_receipt_id,
        amount: parseFloat(r.amount),
        paymentDate: r.payment_date,
        paymentMode: r.payment_mode,
        referenceNumber: r.reference_number,
        bankName: r.bank_name,
        chequeNumber: r.cheque_number,
        chequeDate: r.cheque_date,
        notes: r.notes,
        proposedAllocations: r.proposed_allocations,
        status: r.status,
        submittedBy: r.submitted_by,
        submittedByName: r.submitted_by_name,
        submittedAt: r.submitted_at,
        verifiedBy: r.verified_by,
        verifiedByName: r.verified_by_name,
        verifiedAt: r.verified_at,
        rejectedBy: r.rejected_by,
        rejectedByName: r.rejected_by_name,
        rejectedAt: r.rejected_at,
        rejectionReason: r.rejection_reason,
        createdAt: r.created_at,
        dealerName: r.dealer_name,
        dealerTradeName: r.dealer_trade_name,
        mainName: r.main_name,
        dealerPaymentNumber: r.dealer_payment_number,
        mainReceiptNumber: r.main_receipt_number,
      }));

      return {
        advices,
        stats,
        page,
        limit,
        totalPages: Math.ceil(stats.total / limit) || 1,
      };
    } finally {
      client.release();
    }
  }

  /**
   * 5. GET Single Payment Advice Details (with live server revalidation for Main)
   */
  static async getPaymentAdviceDetails(businessId: string, adviceId: string, isMain: boolean) {
    const client = await pool.connect();
    try {
      const authClause = isMain
        ? `dpa.main_business_id = $1`
        : `dpa.dealer_business_id = $1`;

      const adviceRes = await client.query(
        `SELECT 
           dpa.*,
           db.name as dealer_name,
           db.trade_name as dealer_trade_name,
           db.gstin as dealer_gstin,
           db.phone as dealer_phone,
           mb.name as main_name,
           dp.payment_number as dealer_payment_number,
           dp.unallocated_amount as dealer_unallocated_amount,
           mr.payment_number as main_receipt_number,
           mr.unallocated_amount as main_unallocated_amount,
           sub_u.full_name as submitted_by_name,
           ver_u.full_name as verified_by_name,
           rej_u.full_name as rejected_by_name
         FROM dealer_payment_advices dpa
         JOIN businesses db ON dpa.dealer_business_id = db.id
         JOIN businesses mb ON dpa.main_business_id = mb.id
         LEFT JOIN payments dp ON dpa.dealer_supplier_payment_id = dp.id
         LEFT JOIN payments mr ON dpa.main_customer_receipt_id = mr.id
         LEFT JOIN users sub_u ON dpa.submitted_by = sub_u.id
         LEFT JOIN users ver_u ON dpa.verified_by = ver_u.id
         LEFT JOIN users rej_u ON dpa.rejected_by = rej_u.id
         WHERE ${authClause} AND dpa.id = $2`,
        [businessId, adviceId]
      );

      if (adviceRes.rows.length === 0) {
        throw new Error('Payment Advice not found or access denied.');
      }

      const row = adviceRes.rows[0];
      const proposed = Array.isArray(row.proposed_allocations) ? row.proposed_allocations : [];

      // Server-side revalidation of current Main Sales Invoices
      const validatedAllocations: any[] = [];
      let totalRevalidatedAllocated = 0;

      for (const p of proposed) {
        const item: any = {
          ...p,
          currentMainOutstanding: null,
          isOverAllocated: false,
          safeAllocationAmount: p.allocatedAmount,
          mainInvoiceStatus: null,
        };

        if (p.mainSalesInvoiceId) {
          const siRes = await client.query(
            `SELECT id, invoice_number, grand_total, status,
                    (grand_total - COALESCE((
                      SELECT SUM(pa.allocated_amount)
                      FROM payment_allocations pa
                      JOIN payments pmt ON pmt.id = pa.payment_id
                      WHERE pa.document_id = sales_invoices.id AND pa.status = 'ACTIVE' AND pmt.status = 'POSTED'
                    ), 0))::numeric(12, 2) as current_balance
             FROM sales_invoices
             WHERE id = $1 AND business_id = $2`,
            [p.mainSalesInvoiceId, row.main_business_id]
          );

          if (siRes.rows.length > 0) {
            const si = siRes.rows[0];
            const currentOutstanding = Math.max(0, parseFloat(si.current_balance || '0.00'));
            item.currentMainOutstanding = currentOutstanding;
            item.mainInvoiceStatus = si.status;
            item.mainSalesInvoiceNumber = si.invoice_number;

            if (p.allocatedAmount > currentOutstanding) {
              item.isOverAllocated = true;
              item.safeAllocationAmount = currentOutstanding;
            } else {
              item.safeAllocationAmount = p.allocatedAmount;
            }
          }
        }

        totalRevalidatedAllocated = round2(totalRevalidatedAllocated + item.safeAllocationAmount);
        validatedAllocations.push(item);
      }

      const totalAmount = parseFloat(row.amount);
      const remainingAdvance = round2(Math.max(0, totalAmount - totalRevalidatedAllocated));

      return {
        id: row.id,
        adviceNumber: row.advice_number,
        dealerBusinessId: row.dealer_business_id,
        mainBusinessId: row.main_business_id,
        dealerSupplierPaymentId: row.dealer_supplier_payment_id,
        mainCustomerReceiptId: row.main_customer_receipt_id,
        amount: totalAmount,
        paymentDate: row.payment_date,
        paymentMode: row.payment_mode,
        referenceNumber: row.reference_number,
        bankName: row.bank_name,
        chequeNumber: row.cheque_number,
        chequeDate: row.cheque_date,
        notes: row.notes,
        proposedAllocations: validatedAllocations,
        totalRevalidatedAllocated,
        remainingAdvance,
        status: row.status,
        submittedBy: row.submitted_by,
        submittedByName: row.submitted_by_name,
        submittedAt: row.submitted_at,
        verifiedBy: row.verified_by,
        verifiedByName: row.verified_by_name,
        verifiedAt: row.verified_at,
        rejectedBy: row.rejected_by,
        rejectedByName: row.rejected_by_name,
        rejectedAt: row.rejected_at,
        rejectionReason: row.rejection_reason,
        createdAt: row.created_at,
        dealerName: row.dealer_name,
        dealerTradeName: row.dealer_trade_name,
        dealerGstin: row.dealer_gstin,
        dealerPhone: row.dealer_phone,
        mainName: row.main_name,
        dealerPaymentNumber: row.dealer_payment_number,
        dealerUnallocatedAmount: parseFloat(row.dealer_unallocated_amount || '0.00'),
        mainReceiptNumber: row.main_receipt_number,
        mainUnallocatedAmount: parseFloat(row.main_unallocated_amount || '0.00'),
      };
    } finally {
      client.release();
    }
  }

  /**
   * 6. MAIN WAREHOUSE: Verify Payment & Post Customer Receipt
   * Strictly verifies incoming payment advice, checks invoice outstanding amounts,
   * creates and posts authoritative Customer Receipt in Main Business,
   * reduces Main Customer Ledger balance, and transitions advice to 'VERIFIED'.
   */
  static async verifyAndPostMainReceipt(
    mainBusinessId: string,
    adviceId: string,
    userId: string,
    options: {
      customAllocations?: Array<{
        mainSalesInvoiceId: string;
        allocatedAmount: number;
        notes?: string;
      }>;
      notes?: string;
    } = {}
  ) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Lock payment advice FOR UPDATE
      const advRes = await client.query(
        `SELECT dpa.*, db.name as dealer_name
         FROM dealer_payment_advices dpa
         JOIN businesses db ON dpa.dealer_business_id = db.id
         WHERE dpa.id = $1 AND dpa.main_business_id = $2 FOR UPDATE`,
        [adviceId, mainBusinessId]
      );

      if (advRes.rows.length === 0) {
        throw new Error('Payment Advice not found or access denied.');
      }

      const advice = advRes.rows[0];

      if (advice.status !== 'SUBMITTED') {
        throw new Error(`Cannot verify payment advice in status '${advice.status}'. It is already ${advice.status} and cannot be verified again.`);
      }

      // 2. Resolve Dealer's Customer Party ID in Main Business
      const dealerPartyIdInMain = await DealerControlService.resolveDealerPartyId(
        client,
        mainBusinessId,
        advice.dealer_business_id
      );

      if (!dealerPartyIdInMain) {
        throw new Error(`Dealer '${advice.dealer_name}' has no linked Customer Party in Main Warehouse.`);
      }

      const adviceAmount = round2(parseFloat(advice.amount));

      // 3. Determine Receipt Allocations
      // If custom allocations provided, use them; otherwise revalidate proposed allocations
      let sourceAllocations = options.customAllocations || [];
      if (sourceAllocations.length === 0 && Array.isArray(advice.proposed_allocations)) {
        sourceAllocations = advice.proposed_allocations
          .filter((p: any) => p.mainSalesInvoiceId && p.allocatedAmount > 0)
          .map((p: any) => ({
            mainSalesInvoiceId: p.mainSalesInvoiceId,
            allocatedAmount: p.allocatedAmount,
            notes: p.notes,
          }));
      }

      const finalReceiptAllocations: any[] = [];
      let totalAllocatedToInvoices = 0;

      for (const a of sourceAllocations) {
        if (!a.mainSalesInvoiceId) continue;
        const requestedAmt = round2(parseFloat(a.allocatedAmount as any) || 0);
        if (requestedAmt <= 0) continue;

        // Check Sales Invoice remaining balance
        const siRes = await client.query(
          `SELECT id, invoice_number, grand_total, status,
                  (grand_total - COALESCE((
                    SELECT SUM(pa.allocated_amount)
                    FROM payment_allocations pa
                    JOIN payments pmt ON pmt.id = pa.payment_id
                    WHERE pa.document_id = sales_invoices.id AND pa.status = 'ACTIVE' AND pmt.status = 'POSTED'
                  ), 0))::numeric(12, 2) as current_balance
           FROM sales_invoices
           WHERE id = $1 AND business_id = $2`,
          [a.mainSalesInvoiceId, mainBusinessId]
        );

        if (siRes.rows.length === 0) {
          continue; // skip if invoice not found or cancelled
        }

        const si = siRes.rows[0];
        if (si.status !== 'POSTED') continue;

        const currentBalance = Math.max(0, parseFloat(si.current_balance || '0.00'));
        const safeAlloc = Math.min(requestedAmt, currentBalance);

        if (safeAlloc > 0) {
          // Check that total allocations do not exceed advice amount
          const allowedAlloc = Math.min(safeAlloc, round2(adviceAmount - totalAllocatedToInvoices));
          if (allowedAlloc > 0) {
            finalReceiptAllocations.push({
              documentType: 'SALES_INVOICE',
              documentId: si.id,
              allocatedAmount: allowedAlloc,
              notes: a.notes || `Allocated from Dealer Payment Advice ${advice.advice_number}`,
            });
            totalAllocatedToInvoices = round2(totalAllocatedToInvoices + allowedAlloc);
          }
        }
      }

      const unallocatedAdvance = round2(adviceAmount - totalAllocatedToInvoices);

      // 4. Create authoritative Customer Receipt in Main Business
      // Using existing PaymentService.createPayment with autoPost: true
      const receiptPaymentMode = (
        advice.payment_mode === 'BANK_TRANSFER' ? 'BANK' : advice.payment_mode
      ) as 'CASH' | 'BANK' | 'UPI' | 'CHEQUE' | 'OTHER';

      const mainCustomerReceipt = await PaymentService.createPayment(
        mainBusinessId,
        {
          paymentType: 'RECEIPT',
          partyId: dealerPartyIdInMain,
          paymentDate: advice.payment_date,
          paymentMode: receiptPaymentMode,
          amount: adviceAmount,
          referenceNumber: advice.reference_number || advice.cheque_number || '',
          referenceDate: advice.cheque_date || undefined,
          bankName: advice.bank_name || '',
          notes: `Verified Customer Receipt from Dealer Payment Advice ${advice.advice_number}. ${options.notes || advice.notes || ''}`.trim(),
          allocations: finalReceiptAllocations,
          autoPost: true,
        },
        userId
      );

      // 5. Update Payment Advice Record
      await client.query(
        `UPDATE dealer_payment_advices
         SET status = 'VERIFIED',
             main_customer_receipt_id = $1,
             verified_by = $2,
             verified_at = NOW(),
             updated_at = NOW()
         WHERE id = $3`,
        [mainCustomerReceipt.id, userId, advice.id]
      );

      await client.query('COMMIT');

      // 6. Audit Log
      await AuditService.log({
        businessId: mainBusinessId,
        userId,
        module: 'dealers',
        action: 'VERIFY_DEALER_PAYMENT',
        entityType: 'dealer_payment_advice',
        entityId: advice.id,
        newValue: {
          adviceNumber: advice.advice_number,
          mainReceiptId: mainCustomerReceipt.id,
          mainReceiptNumber: mainCustomerReceipt.payment_number,
          verifiedAmount: adviceAmount,
          totalAllocatedToInvoices,
          unallocatedAdvance,
        },
      });

      return {
        success: true,
        adviceId: advice.id,
        adviceNumber: advice.advice_number,
        mainCustomerReceiptId: mainCustomerReceipt.id,
        mainReceiptNumber: mainCustomerReceipt.payment_number,
        verifiedAmount: adviceAmount,
        totalAllocatedToInvoices,
        unallocatedAdvance,
        status: 'VERIFIED',
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * 7. MAIN WAREHOUSE: Reject Payment Advice
   * Does NOT delete Dealer's Supplier Payment (respects financial history).
   * Marks advice as REJECTED with reason, so Dealer can review or correct.
   */
  static async rejectPaymentAdvice(
    mainBusinessId: string,
    adviceId: string,
    userId: string,
    rejectionReason: string
  ) {
    const client = await pool.connect();
    try {
      if (!rejectionReason || rejectionReason.trim().length === 0) {
        throw new Error('A rejection reason must be provided.');
      }

      await client.query('BEGIN');

      const advRes = await client.query(
        `SELECT dpa.*, db.name as dealer_name
         FROM dealer_payment_advices dpa
         JOIN businesses db ON dpa.dealer_business_id = db.id
         WHERE dpa.id = $1 AND dpa.main_business_id = $2 FOR UPDATE`,
        [adviceId, mainBusinessId]
      );

      if (advRes.rows.length === 0) {
        throw new Error('Payment Advice not found or access denied.');
      }

      const advice = advRes.rows[0];

      if (advice.status !== 'SUBMITTED') {
        throw new Error(`Cannot reject payment advice in status '${advice.status}'.`);
      }

      await client.query(
        `UPDATE dealer_payment_advices
         SET status = 'REJECTED',
             rejection_reason = $1,
             rejected_by = $2,
             rejected_at = NOW(),
             updated_at = NOW()
         WHERE id = $3`,
        [rejectionReason.trim(), userId, advice.id]
      );

      await client.query('COMMIT');

      // Audit Log
      await AuditService.log({
        businessId: mainBusinessId,
        userId,
        module: 'dealers',
        action: 'REJECT_DEALER_PAYMENT',
        entityType: 'dealer_payment_advice',
        entityId: advice.id,
        newValue: {
          adviceNumber: advice.advice_number,
          dealerBusinessId: advice.dealer_business_id,
          rejectionReason: rejectionReason.trim(),
        },
      });

      return {
        success: true,
        adviceId: advice.id,
        adviceNumber: advice.advice_number,
        status: 'REJECTED',
        rejectionReason: rejectionReason.trim(),
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * 8. Inter-business Payment Reconciliation
   * Authoritatively compares Main Customer Ledger vs Dealer Supplier Ledger,
   * accounting for payments awaiting verification.
   */
  static async getPaymentReconciliation(mainBusinessId: string, dealerBusinessId: string) {
    const client = await pool.connect();
    try {
      // 1. Dealer info
      const dealerRes = await client.query(
        `SELECT d.name as dealer_name, m.name as main_name
         FROM businesses d
         JOIN businesses m ON m.id = $1
         WHERE d.id = $2`,
        [mainBusinessId, dealerBusinessId]
      );
      if (dealerRes.rows.length === 0) {
        throw new Error('Dealer not found.');
      }
      const { dealer_name: dealerName, main_name: mainName } = dealerRes.rows[0];

      // 2. Main Customer Ledger balance (authoritative Main receivable)
      const partyIdInMain = await DealerControlService.resolveDealerPartyId(client, mainBusinessId, dealerBusinessId);
      let mainCustomerBalance = 0;
      let lastMainLedgerDate: string | null = null;

      if (partyIdInMain) {
        const clRes = await client.query(
          `SELECT balance, created_at FROM customer_ledgers
           WHERE business_id = $1 AND party_id = $2
           ORDER BY created_at DESC LIMIT 1`,
          [mainBusinessId, partyIdInMain]
        );
        if (clRes.rows.length > 0) {
          mainCustomerBalance = parseFloat(clRes.rows[0].balance || '0.00');
          lastMainLedgerDate = clRes.rows[0].created_at;
        }
      }

      // 3. Dealer Supplier Ledger balance (authoritative Dealer payable)
      const partyResInDealer = await client.query(
        `SELECT id FROM parties
         WHERE business_id = $1 AND party_type IN ('SUPPLIER', 'BOTH')
           AND (
             notes LIKE $2
             OR LOWER(name) = LOWER($3)
             OR (display_name IS NOT NULL AND LOWER(display_name) = LOWER($3))
           )
         ORDER BY created_at DESC LIMIT 1`,
        [dealerBusinessId, `%[MAIN_BIZ:${mainBusinessId}]%`, mainName]
      );

      let dealerSupplierBalance = 0;
      let lastDealerLedgerDate: string | null = null;
      if (partyResInDealer.rows.length > 0) {
        const supPartyId = partyResInDealer.rows[0].id;
        const slRes = await client.query(
          `SELECT balance, created_at FROM supplier_ledgers
           WHERE business_id = $1 AND party_id = $2
           ORDER BY created_at DESC LIMIT 1`,
          [dealerBusinessId, supPartyId]
        );
        if (slRes.rows.length > 0) {
          dealerSupplierBalance = parseFloat(slRes.rows[0].balance || '0.00');
          lastDealerLedgerDate = slRes.rows[0].created_at;
        }
      }

      // 4. Payments awaiting verification
      const pendingAdvRes = await client.query(
        `SELECT id, advice_number, amount, payment_date, payment_mode, reference_number, created_at
         FROM dealer_payment_advices
         WHERE dealer_business_id = $1 AND main_business_id = $2 AND status = 'SUBMITTED'
         ORDER BY payment_date DESC`,
        [dealerBusinessId, mainBusinessId]
      );

      const pendingAdvices = pendingAdvRes.rows.map(r => ({
        id: r.id,
        adviceNumber: r.advice_number,
        amount: parseFloat(r.amount),
        paymentDate: r.payment_date,
        paymentMode: r.payment_mode,
        referenceNumber: r.reference_number,
        createdAt: r.created_at,
      }));

      const paymentsAwaitingVerification = pendingAdvices.reduce((sum, a) => round2(sum + a.amount), 0);

      const rawDifference = round2(mainCustomerBalance - dealerSupplierBalance);
      const reconciledDifference = round2(rawDifference - paymentsAwaitingVerification);

      let reconciliationStatus: 'MATCHED' | 'TIMING_PENDING_PAYMENTS' | 'DISCREPANCY';
      const notes: string[] = [];

      if (Math.abs(rawDifference) < 0.01) {
        reconciliationStatus = 'MATCHED';
        notes.push('Ledgers are perfectly in sync. Main Customer Ledger matches Dealer Supplier Ledger exactly.');
      } else if (Math.abs(reconciledDifference) < 0.01 && paymentsAwaitingVerification > 0) {
        reconciliationStatus = 'TIMING_PENDING_PAYMENTS';
        notes.push(`The temporary difference of ₹${rawDifference.toLocaleString('en-IN', { minimumFractionDigits: 2 })} is fully explained by ₹${paymentsAwaitingVerification.toLocaleString('en-IN', { minimumFractionDigits: 2 })} in payments recorded by Dealer awaiting Main Warehouse verification.`);
      } else {
        reconciliationStatus = 'DISCREPANCY';
        notes.push(`Net ledger difference of ₹${Math.abs(rawDifference).toLocaleString('en-IN', { minimumFractionDigits: 2 })} detected.`);
        if (paymentsAwaitingVerification > 0) {
          notes.push(`₹${paymentsAwaitingVerification.toLocaleString('en-IN', { minimumFractionDigits: 2 })} is currently awaiting verification.`);
        }
        notes.push('Discrepancies may also stem from shipments in transit, pending GRN conversions, or debit/credit notes in process.');
      }

      return {
        dealerName,
        mainName,
        mainCustomerBalance,
        dealerSupplierBalance,
        rawDifference,
        paymentsAwaitingVerification,
        reconciledDifference,
        reconciliationStatus,
        pendingAdvices,
        lastMainLedgerDate,
        lastDealerLedgerDate,
        reconciledAt: new Date().toISOString(),
        notes,
      };
    } finally {
      client.release();
    }
  }
}
