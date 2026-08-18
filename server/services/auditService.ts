import { db } from '../db/index.js';
import { auditLogs } from '../db/schema.js';
import { Request } from 'express';

export interface RecordAuditParams {
  businessId?: string | null;
  userId?: string | null;
  action: string;
  module: string;
  entityType: string;
  entityId?: string | null;
  previousValue?: any;
  newValue?: any;
  req?: Request;
}

export async function recordAuditLog(params: RecordAuditParams) {
  try {
    let ipAddress: string | undefined;
    let userAgent: string | undefined;

    if (params.req) {
      const forwarded = params.req.headers['x-forwarded-for'];
      ipAddress = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : params.req.socket.remoteAddress;
      userAgent = params.req.headers['user-agent'];
    }

    const [log] = await db.insert(auditLogs).values({
      businessId: params.businessId || null,
      userId: params.userId || null,
      action: params.action,
      module: params.module,
      entityType: params.entityType,
      entityId: params.entityId || null,
      previousValue: params.previousValue ? JSON.stringify(params.previousValue) : null,
      newValue: params.newValue ? JSON.stringify(params.newValue) : null,
      ipAddress: ipAddress || null,
      userAgent: userAgent || null,
    }).returning();

    return log;
  } catch (error) {
    console.error('[Audit Service Error] Failed to write audit log:', error);
    // Audit logging should not crash the main transaction if DB allows, but we log the error
    return null;
  }
}
