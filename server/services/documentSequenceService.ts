import { Pool, PoolClient } from 'pg';
import { pool } from '../db/index.js';
import { BusinessSettingsService } from './businessSettingsService.js';

export type DocumentType =
  | 'SALES_INVOICE'
  | 'SALES_ORDER'
  | 'SALES_RETURN'
  | 'PURCHASE_INVOICE'
  | 'PURCHASE_ORDER'
  | 'PURCHASE_RETURN'
  | 'CUSTOMER_RECEIPT'
  | 'SUPPLIER_PAYMENT'
  | 'DEALER_ORDER'
  | 'DEALER_SHIPMENT'
  | 'DEALER_GRN'
  | 'DEALER_ADVICE'
  | 'DEALER_RETURN';

export interface NextNumberOptions {
  voucherDate?: Date | string;
  customPrefix?: string;
  startNumber?: number;
  useFyInPrefix?: boolean;
}

export class DocumentSequenceService {
  /**
   * Resolves the financial year string (e.g. "2026-27" and "26-27")
   * for a given voucher date using the business's configured financialYearStart (default "04-01").
   */
  static async resolveFinancialYear(
    businessId: string,
    voucherDate?: Date | string
  ): Promise<{ fyKey: string; fyShort: string; startYear: number; endYear: number }> {
    const vDate = voucherDate ? new Date(voucherDate) : new Date();
    const validDate = isNaN(vDate.getTime()) ? new Date() : vDate;

    // Retrieve business setting for financialYearStart (e.g. "04-01")
    let fyStart = '04-01';
    try {
      const settings = await BusinessSettingsService.getSettings(businessId);
      if (settings?.settings?.general?.financialYearStart) {
        fyStart = settings.settings.general.financialYearStart;
      }
    } catch {
      // Fallback to "04-01"
    }

    const [fyStartMonthStr, fyStartDayStr] = fyStart.split('-');
    const fyStartMonth = parseInt(fyStartMonthStr || '4', 10); // 1-12
    const fyStartDay = parseInt(fyStartDayStr || '1', 10);

    const year = validDate.getFullYear();
    const month = validDate.getMonth() + 1; // 1-12
    const day = validDate.getDate();

    // Check if voucher date is on or after FY start in current calendar year
    const isAfterFyStart =
      month > fyStartMonth || (month === fyStartMonth && day >= fyStartDay);

    const startYear = isAfterFyStart ? year : year - 1;
    const endYear = startYear + 1;

    const startYearStr = String(startYear);
    const endYearStr = String(endYear).slice(-2);

    const fyKey = `${startYear}-${endYearStr}`; // e.g. "2026-27"
    const fyShort = `${startYearStr.slice(-2)}-${endYearStr}`; // e.g. "26-27"

    return { fyKey, fyShort, startYear, endYear };
  }

  /**
   * Atomically generates the next sequential voucher number for a business and document type.
   * Completely immune to concurrent races via Postgres ON CONFLICT DO UPDATE row-level locks.
   */
  static async getNextVoucherNumber(
    clientOrPool: PoolClient | Pool,
    businessId: string,
    documentType: DocumentType,
    options?: NextNumberOptions
  ): Promise<string> {
    const executor = clientOrPool || pool;

    // 1. Fetch settings for this document type
    const settingsRes = await BusinessSettingsService.getSettings(businessId).catch(() => null);
    const resetNumbering =
      settingsRes?.settings?.voucherNumbering?.resetNumbering || 'NEVER';

    // Map documentType to settings key
    const mapping: Record<DocumentType, string> = {
      SALES_INVOICE: 'salesInvoice',
      SALES_ORDER: 'salesOrder',
      SALES_RETURN: 'salesReturn',
      PURCHASE_INVOICE: 'purchaseInvoice',
      PURCHASE_ORDER: 'purchaseOrder',
      PURCHASE_RETURN: 'purchaseReturn',
      CUSTOMER_RECEIPT: 'customerReceipt',
      SUPPLIER_PAYMENT: 'supplierPayment',
      DEALER_ORDER: 'dealerOrder',
      DEALER_SHIPMENT: 'dealerShipment',
      DEALER_GRN: 'dealerGoodsReceipt',
      DEALER_ADVICE: 'dealerPaymentAdvice',
      DEALER_RETURN: 'dealerReturn',
    };

    const settingKey = mapping[documentType] || 'salesInvoice';
    const vConfig =
      (settingsRes?.settings?.voucher?.numbering as any)?.[settingKey] ||
      (settingsRes?.settings?.voucherNumbering as any)?.[settingKey];

    const defaultPrefixes: Record<DocumentType, string> = {
      SALES_INVOICE: 'INV-',
      SALES_ORDER: 'SO-',
      SALES_RETURN: 'SR-',
      PURCHASE_INVOICE: 'PUR-',
      PURCHASE_ORDER: 'PO-',
      PURCHASE_RETURN: 'PR-',
      CUSTOMER_RECEIPT: 'REC-',
      SUPPLIER_PAYMENT: 'PAY-',
      DEALER_ORDER: 'DO-',
      DEALER_SHIPMENT: 'SHP-',
      DEALER_GRN: 'GR-',
      DEALER_ADVICE: 'ADV-',
      DEALER_RETURN: 'RET-',
    };

    const prefix = options?.customPrefix || vConfig?.prefix || defaultPrefixes[documentType] || 'VCH-';
    const startNumber = options?.startNumber || vConfig?.startNumber || 1;

    // 2. Determine FY key if FY-reset is enabled
    const fyResolution = await this.resolveFinancialYear(businessId, options?.voucherDate);
    const financialYear = resetNumbering === 'FINANCIAL_YEAR' ? fyResolution.fyKey : 'ALL';

    // 3. Atomically upsert and increment sequence
    // First, verify if the row exists
    const checkRes = await executor.query(
      `SELECT current_number FROM document_sequences 
       WHERE business_id = $1 AND document_type = $2 AND financial_year = $3 
       FOR UPDATE`,
      [businessId, documentType, financialYear]
    );

    let nextNumber: number;

    if (checkRes.rows.length === 0) {
      // Find maximum existing number in records if table was already populated prior to sequence migration
      const existingMax = await this.findExistingMaxNumber(
        executor,
        businessId,
        documentType,
        prefix
      );
      const initialSeed = Math.max(existingMax, startNumber - 1);
      nextNumber = initialSeed + 1;

      const insertRes = await executor.query(
        `INSERT INTO document_sequences (business_id, document_type, financial_year, current_number, prefix, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (business_id, document_type, financial_year)
         DO UPDATE SET 
           current_number = document_sequences.current_number + 1,
           updated_at = NOW()
         RETURNING current_number`,
        [businessId, documentType, financialYear, nextNumber, prefix]
      );
      nextNumber = insertRes.rows[0].current_number;
    } else {
      const updateRes = await executor.query(
        `UPDATE document_sequences 
         SET current_number = current_number + 1, updated_at = NOW() 
         WHERE business_id = $1 AND document_type = $2 AND financial_year = $3 
         RETURNING current_number`,
        [businessId, documentType, financialYear]
      );
      nextNumber = updateRes.rows[0].current_number;
    }

    // 4. Format canonical voucher number
    const padded = String(nextNumber).padStart(6, '0');
    if (options?.useFyInPrefix) {
      return `${prefix}${fyResolution.fyShort}/${padded}`;
    }
    return `${prefix}${padded}`;
  }

  /**
   * Helper to scan existing table to initialize sequence counter accurately
   */
  private static async findExistingMaxNumber(
    executor: PoolClient | Pool,
    businessId: string,
    documentType: DocumentType,
    prefix: string
  ): Promise<number> {
    try {
      let query = '';
      if (documentType === 'SALES_INVOICE') {
        query = `SELECT invoice_number AS num FROM sales_invoices WHERE business_id = $1`;
      } else if (documentType === 'SALES_ORDER') {
        query = `SELECT order_number AS num FROM sales_orders WHERE business_id = $1`;
      } else if (documentType === 'SALES_RETURN') {
        query = `SELECT return_number AS num FROM sales_returns WHERE business_id = $1`;
      } else if (documentType === 'PURCHASE_INVOICE') {
        query = `SELECT invoice_number AS num FROM purchase_invoices WHERE business_id = $1`;
      } else if (documentType === 'PURCHASE_ORDER') {
        query = `SELECT order_number AS num FROM purchase_orders WHERE business_id = $1`;
      } else if (documentType === 'PURCHASE_RETURN') {
        query = `SELECT return_number AS num FROM purchase_returns WHERE business_id = $1`;
      } else if (documentType === 'CUSTOMER_RECEIPT' || documentType === 'SUPPLIER_PAYMENT') {
        const pType = documentType === 'CUSTOMER_RECEIPT' ? 'RECEIPT' : 'PAYMENT';
        query = `SELECT payment_number AS num FROM payments WHERE business_id = $1 AND payment_type = '${pType}'`;
      } else if (documentType === 'DEALER_ORDER') {
        query = `SELECT order_number AS num FROM dealer_orders WHERE dealer_business_id = $1`;
      } else if (documentType === 'DEALER_SHIPMENT') {
        query = `SELECT shipment_number AS num FROM dealer_shipments WHERE main_business_id = $1`;
      } else if (documentType === 'DEALER_GRN') {
        query = `SELECT receipt_number AS num FROM dealer_goods_receipts WHERE dealer_business_id = $1`;
      } else if (documentType === 'DEALER_ADVICE') {
        query = `SELECT advice_number AS num FROM dealer_payment_advices WHERE dealer_business_id = $1`;
      } else if (documentType === 'DEALER_RETURN') {
        query = `SELECT return_number AS num FROM dealer_returns WHERE dealer_business_id = $1`;
      } else {
        return 0;
      }

      const res = await executor.query(query, [businessId]);
      let maxFound = 0;
      for (const row of res.rows) {
        if (!row.num) continue;
        const cleaned = String(row.num).replace(/^[^\d]+/, '');
        const parsed = parseInt(cleaned, 10);
        if (!isNaN(parsed) && parsed > maxFound) {
          maxFound = parsed;
        }
      }
      return maxFound;
    } catch {
      return 0;
    }
  }

  /**
   * Idempotency Check: Returns existing resourceId if this request has already been processed.
   */
  static async checkIdempotency(
    executor: PoolClient | Pool,
    businessId: string,
    resourceType: string,
    idempotencyKey?: string | null
  ): Promise<string | null> {
    if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
      return null;
    }
    const cleanKey = idempotencyKey.trim();
    const res = await executor.query(
      `SELECT resource_id FROM idempotency_records 
       WHERE business_id = $1 AND resource_type = $2 AND idempotency_key = $3`,
      [businessId, resourceType, cleanKey]
    );
    if (res.rows.length > 0) {
      return res.rows[0].resource_id;
    }
    return null;
  }

  /**
   * Idempotency Record: Saves the resourceId for the provided idempotencyKey.
   */
  static async recordIdempotency(
    executor: PoolClient | Pool,
    businessId: string,
    resourceType: string,
    idempotencyKey: string | undefined | null,
    resourceId: string
  ): Promise<void> {
    if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
      return;
    }
    const cleanKey = idempotencyKey.trim();
    await executor.query(
      `INSERT INTO idempotency_records (business_id, resource_type, idempotency_key, resource_id, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (business_id, resource_type, idempotency_key) DO NOTHING`,
      [businessId, resourceType, cleanKey, resourceId]
    );
  }
}
