import { db, pool } from '../db';
import { eq } from 'drizzle-orm';
import { importSessions } from '../db/schema';
import { ImportType } from './excelTemplateService';
import { ImportValidationService, ValidatedRow, DocumentGroup, ValidationResult } from './importValidationService';
import { PartyService } from './partyService';
import { PurchaseService } from './purchaseService';
import { SalesService } from './salesService';
import { StockService } from './stockService';
import { findOrCreateOpticalBatch } from './opticalMasterService';
import { AuditService } from './auditService';

export interface PostingResult {
  sessionId: string;
  importType: ImportType;
  status: 'COMPLETED' | 'COMPLETED_WITH_ERRORS' | 'FAILED';
  totalRows: number;
  postedRows: number;
  failedRows: number;
  postedDocuments: Array<{ id: string; type: string; documentNumber?: string; summary?: string }>;
  errors: Array<{ row?: number; documentKey?: string; message: string }>;
}

export class ImportPostingService {
  /**
   * Executes transactional posting for a validated import session.
   */
  static async postImportSession(
    businessId: string,
    sessionId: string,
    userId?: string
  ): Promise<PostingResult> {
    const [session] = await db
      .select()
      .from(importSessions)
      .where(eq(importSessions.id, sessionId))
      .limit(1);

    if (!session) {
      throw new Error(`Import session ${sessionId} not found.`);
    }

    if (session.businessId !== businessId) {
      throw new Error('Unauthorized access to import session.');
    }

    if (session.status === 'COMPLETED') {
      throw new Error('This import session has already been posted and completed.');
    }

    // Set session status to POSTING
    await db
      .update(importSessions)
      .set({
        status: 'POSTING',
        startedAt: new Date(),
      })
      .where(eq(importSessions.id, sessionId));

    const importType = session.importType as ImportType;
    const previewData = session.previewData as any;
    const rows: ValidatedRow[] = previewData?.rows || [];
    const documentGroups: DocumentGroup[] = previewData?.documentGroups || [];

    const postedDocuments: Array<{ id: string; type: string; documentNumber?: string; summary?: string }> = [];
    const executionErrors: Array<{ row?: number; documentKey?: string; message: string }> = [];
    let postedRowsCount = 0;
    let failedRowsCount = 0;

    try {
      switch (importType) {
        case 'PARTY': {
          for (const row of rows) {
            if (!row.isValid) {
              failedRowsCount++;
              continue;
            }

            try {
              const created = await PartyService.createParty(
                businessId,
                {
                  name: row.resolvedData?.name,
                  displayName: row.mapped.displayName,
                  partyType: row.resolvedData?.partyType,
                  partyCode: row.resolvedData?.partyCode,
                  mobile: row.resolvedData?.mobile,
                  alternateMobile: row.mapped.alternateMobile,
                  email: row.resolvedData?.email,
                  addressLine1: row.mapped.addressLine1,
                  addressLine2: row.mapped.addressLine2,
                  city: row.mapped.city,
                  state: row.mapped.state,
                  pincode: row.mapped.pincode,
                  gstin: row.resolvedData?.gstin,
                  pan: row.mapped.pan,
                  creditLimit: row.resolvedData?.creditLimit,
                  creditDays: row.resolvedData?.creditDays,
                  status: row.mapped.status?.toUpperCase() === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
                  notes: row.mapped.notes,
                },
                userId
              );

              postedDocuments.push({
                id: created.id,
                type: 'PARTY',
                documentNumber: created.partyCode,
                summary: created.name,
              });
              postedRowsCount++;
            } catch (err: any) {
              failedRowsCount++;
              executionErrors.push({ row: row.rowNumber, message: err.message || 'Failed to create party.' });
            }
          }
          break;
        }

        case 'PURCHASE': {
          for (const group of documentGroups) {
            if (!group.isValid) {
              failedRowsCount += group.lines.length;
              continue;
            }

            try {
              // 1. Resolve or create batches for each line item
              const linesWithBatches = [];
              for (const line of group.lines) {
                const uniqueItemId = line.resolvedData?.uniqueItem?.id;
                const powers = line.resolvedData?.powers;
                const qty = Number(line.resolvedData?.quantity);
                const rate = Number(line.resolvedData?.rate);

                // Find or create optical batch
                const batchRes = await findOrCreateOpticalBatch({
                  businessId,
                  uniqueItemId,
                  sph: powers.sph,
                  cyl: powers.cyl,
                  axis: powers.axis || undefined,
                  add: powers.add || undefined,
                  side: powers.side || 'NONE',
                  userId,
                });

                linesWithBatches.push({
                  uniqueItemId,
                  quantity: qty,
                  rate,
                  discountType: line.resolvedData?.discountType,
                  discountValue: Number(line.resolvedData?.discountValue || 0),
                  batches: [
                    {
                      batchId: batchRes.batch.id,
                      quantity: qty,
                      rate,
                    },
                  ],
                });
              }

              // 2. Create Purchase Invoice
              const invDto = {
                supplierPartyId: group.headerData.supplier.id,
                invoiceDate: group.headerData.invoiceDate || new Date().toISOString().split('T')[0],
                supplierInvoiceNumber: group.headerData.supplierInvoiceNumber,
                supplierInvoiceDate: group.headerData.supplierInvoiceDate,
                gstMode: group.headerData.gstMode,
                notes: `Bulk Imported from ${session.fileName}`,
                lines: linesWithBatches,
              };

              const invoice = await PurchaseService.createPurchaseInvoice(businessId, invDto, userId);

              // 3. Automatically post invoice to stock and supplier ledger
              await PurchaseService.postPurchaseInvoice(businessId, invoice.id, userId);

              postedDocuments.push({
                id: invoice.id,
                type: 'PURCHASE_INVOICE',
                documentNumber: invoice.invoiceNumber,
                summary: `Supplier: ${group.headerData.supplier.name} | Items: ${group.lines.length}`,
              });
              postedRowsCount += group.lines.length;
            } catch (err: any) {
              failedRowsCount += group.lines.length;
              executionErrors.push({
                documentKey: group.documentKey,
                message: `Failed to create/post purchase invoice for supplier "${group.headerData.supplier?.name}": ${err.message}`,
              });
            }
          }
          break;
        }

        case 'SALES_ORDER': {
          for (const group of documentGroups) {
            if (!group.isValid) {
              failedRowsCount += group.lines.length;
              continue;
            }

            try {
              const lines = [];
              for (const line of group.lines) {
                const uniqueItemId = line.resolvedData?.uniqueItem?.id;
                const powers = line.resolvedData?.powers;
                const qty = Number(line.resolvedData?.quantity);
                const rate = Number(line.resolvedData?.rate);

                const batchRes = await findOrCreateOpticalBatch({
                  businessId,
                  uniqueItemId,
                  sph: powers.sph,
                  cyl: powers.cyl,
                  axis: powers.axis || undefined,
                  add: powers.add || undefined,
                  side: powers.side || 'NONE',
                  userId,
                });

                lines.push({
                  uniqueItemId,
                  quantity: qty,
                  rate,
                  discountType: line.resolvedData?.discountType,
                  discountValue: Number(line.resolvedData?.discountValue || 0),
                  batches: [
                    {
                      batchId: batchRes.batch.id,
                      quantity: qty,
                    },
                  ],
                });
              }

              const soDto = {
                partyId: group.headerData.customer.id,
                orderDate: group.headerData.orderDate || new Date().toISOString().split('T')[0],
                gstMode: group.headerData.gstMode,
                notes: `Bulk Imported from ${session.fileName}`,
                lines,
                status: 'CONFIRMED' as const,
              };

              const order = await SalesService.createSalesOrder(businessId, soDto, userId);

              postedDocuments.push({
                id: order.id,
                type: 'SALES_ORDER',
                documentNumber: order.orderNumber,
                summary: `Customer: ${group.headerData.customer.name} | Lines: ${group.lines.length}`,
              });
              postedRowsCount += group.lines.length;
            } catch (err: any) {
              failedRowsCount += group.lines.length;
              executionErrors.push({
                documentKey: group.documentKey,
                message: `Failed to create sales order for customer "${group.headerData.customer?.name}": ${err.message}`,
              });
            }
          }
          break;
        }

        case 'SALES_INVOICE': {
          for (const group of documentGroups) {
            if (!group.isValid) {
              failedRowsCount += group.lines.length;
              continue;
            }

            try {
              const lines = [];
              for (const line of group.lines) {
                const uniqueItemId = line.resolvedData?.uniqueItem?.id;
                const qty = Number(line.resolvedData?.quantity);
                const rate = Number(line.resolvedData?.rate);
                const batch = line.resolvedData?.existingBatch;

                if (!batch) {
                  throw new Error(`Batch not found for line on row ${line.rowNumber}`);
                }

                lines.push({
                  uniqueItemId,
                  quantity: qty,
                  rate,
                  discountType: line.resolvedData?.discountType,
                  discountValue: Number(line.resolvedData?.discountValue || 0),
                  batches: [
                    {
                      batchId: batch.id,
                      quantity: qty,
                    },
                  ],
                });
              }

              const invDto = {
                partyId: group.headerData.customer.id,
                invoiceDate: group.headerData.invoiceDate || new Date().toISOString().split('T')[0],
                gstMode: group.headerData.gstMode,
                notes: `Bulk Imported from ${session.fileName}`,
                lines,
                status: 'POSTED' as const,
              };

              const invoice = await SalesService.createSalesInvoice(businessId, invDto, userId);

              postedDocuments.push({
                id: invoice.id,
                type: 'SALES_INVOICE',
                documentNumber: invoice.invoiceNumber,
                summary: `Customer: ${group.headerData.customer.name} | Lines: ${group.lines.length}`,
              });
              postedRowsCount += group.lines.length;
            } catch (err: any) {
              failedRowsCount += group.lines.length;
              executionErrors.push({
                documentKey: group.documentKey,
                message: `Failed to create/post sales invoice for customer "${group.headerData.customer?.name}": ${err.message}`,
              });
            }
          }
          break;
        }

        case 'OPENING_STOCK': {
          for (const row of rows) {
            if (!row.isValid) {
              failedRowsCount++;
              continue;
            }

            try {
              const batch = row.resolvedData?.existingBatch;
              if (!batch) {
                throw new Error('Batch does not exist for opening stock entry.');
              }

              await StockService.recordOpeningStock(
                businessId,
                {
                  batchId: batch.id,
                  quantity: Number(row.resolvedData?.quantity),
                  date: row.mapped.date || undefined,
                  reason: row.mapped.reason || 'Bulk Opening Stock Import',
                },
                userId
              );

              postedDocuments.push({
                id: batch.id,
                type: 'OPENING_STOCK',
                documentNumber: batch.barcode,
                summary: `${row.resolvedData?.uniqueItem?.name} (Qty: ${row.resolvedData?.quantity})`,
              });
              postedRowsCount++;
            } catch (err: any) {
              failedRowsCount++;
              executionErrors.push({
                row: row.rowNumber,
                message: `Failed to record opening stock for row ${row.rowNumber}: ${err.message}`,
              });
            }
          }
          break;
        }
      }
    } catch (globalErr: any) {
      executionErrors.push({ message: `Fatal error during import execution: ${globalErr.message}` });
    }

    // Determine final status
    let finalStatus: 'COMPLETED' | 'COMPLETED_WITH_ERRORS' | 'FAILED' = 'COMPLETED';
    if (postedRowsCount === 0 && failedRowsCount > 0) {
      finalStatus = 'FAILED';
    } else if (failedRowsCount > 0) {
      finalStatus = 'COMPLETED_WITH_ERRORS';
    }

    // Update import_sessions record
    await db
      .update(importSessions)
      .set({
        status: finalStatus,
        postedRows: String(postedRowsCount),
        failedRows: String(failedRowsCount),
        postedDocumentIds: postedDocuments,
        completedAt: new Date(),
      })
      .where(eq(importSessions.id, sessionId));

    // Record system audit log
    await AuditService.log({
      businessId,
      userId,
      module: 'IMPORT',
      entityType: 'import_sessions',
      entityId: sessionId,
      action: 'IMPORT_POSTED',
      newValue: {
        importType,
        fileName: session.fileName,
        finalStatus,
        postedRowsCount,
        failedRowsCount,
        postedDocumentsCount: postedDocuments.length,
      },
    });

    return {
      sessionId,
      importType,
      status: finalStatus,
      totalRows: rows.length,
      postedRows: postedRowsCount,
      failedRows: failedRowsCount,
      postedDocuments,
      errors: executionErrors,
    };
  }
}
