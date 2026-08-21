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

function sanitizeAuditData(data: any): any {
  if (!data) return data;
  if (typeof data !== 'object') return data;
  
  if (Array.isArray(data)) {
    return data.map(item => sanitizeAuditData(item));
  }
  
  const sanitized: Record<string, any> = {};
  const sensitiveKeys = ['password', 'passwordhash', 'password_hash', 'token', 'secret', 'jwt', 'auth', 'authorization', 'accesstoken', 'refreshtoken'];
  
  for (const [key, value] of Object.entries(data)) {
    if (sensitiveKeys.some(s => key.toLowerCase().includes(s))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeAuditData(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
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

    const cleanPrevious = sanitizeAuditData(params.previousValue);
    const cleanNew = sanitizeAuditData(params.newValue);

    const [log] = await db.insert(auditLogs).values({
      businessId: params.businessId || null,
      userId: params.userId || null,
      action: params.action,
      module: params.module,
      entityType: params.entityType,
      entityId: params.entityId || null,
      previousValue: cleanPrevious ? JSON.stringify(cleanPrevious) : null,
      newValue: cleanNew ? JSON.stringify(cleanNew) : null,
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

export class AuditService {
  static async log(params: RecordAuditParams) {
    return recordAuditLog(params);
  }
}
