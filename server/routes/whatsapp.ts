import { Router, Request, Response, NextFunction } from 'express';
import { WhatsAppService } from '../services/whatsapp/whatsappService.js';
import { authenticateToken } from '../middleware/auth.js';
import { pool } from '../db/index.js';

const router = Router();

// Middleware: all WhatsApp routes require authentication & active business context
router.use(authenticateToken);
router.use((req: Request, res: Response, next: NextFunction) => {
  const businessId = req.user?.currentBusinessId || (req.headers['x-business-id'] as string);
  if (!businessId) {
    res.status(400).json({ error: 'BUSINESS_CONTEXT_REQUIRED', message: 'Active business context is required' });
    return;
  }
  (req as any).businessId = businessId;
  next();
});

/**
 * GET /api/whatsapp/status
 * Get connection session status & configuration
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const businessId = (req as any).businessId;
    const session = await WhatsAppService.getSession(businessId);
    const settings = await WhatsAppService.getWhatsAppSettings(businessId);

    res.json({
      success: true,
      session,
      settings,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to fetch WhatsApp status' });
  }
});

/**
 * POST /api/whatsapp/connect
 * Initiate a new QR code link session
 */
router.post('/connect', async (req: Request, res: Response) => {
  try {
    const businessId = (req as any).businessId;
    const sessionData = await WhatsAppService.initiateLinkSession(businessId);

    res.json({
      success: true,
      message: 'QR Code generated. Scan with WhatsApp on your mobile phone (Linked Devices).',
      ...sessionData,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to initiate WhatsApp session' });
  }
});

/**
 * POST /api/whatsapp/confirm-auth
 * Confirm authentication for the linking session
 */
router.post('/confirm-auth', async (req: Request, res: Response) => {
  try {
    const businessId = (req as any).businessId;
    const { phone, pushname } = req.body;

    const authRes = await WhatsAppService.confirmAuthentication(businessId, { phone, pushname });

    res.json({
      success: true,
      message: 'WhatsApp account successfully linked and authenticated.',
      ...authRes,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to confirm authentication' });
  }
});

/**
 * POST /api/whatsapp/disconnect
 * Disconnect current WhatsApp session
 */
router.post('/disconnect', async (req: Request, res: Response) => {
  try {
    const businessId = (req as any).businessId;
    const result = await WhatsAppService.disconnectSession(businessId);

    res.json({
      success: true,
      message: 'WhatsApp session disconnected successfully.',
      ...result,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to disconnect WhatsApp' });
  }
});

/**
 * POST /api/whatsapp/test-connection
 * Verify WhatsApp session without spamming test messages
 */
router.post('/test-connection', async (req: Request, res: Response) => {
  try {
    const businessId = (req as any).businessId;
    const result = await WhatsAppService.testConnection(businessId);

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to test connection' });
  }
});

/**
 * GET /api/whatsapp/settings
 * Fetch WhatsApp business configuration
 */
router.get('/settings', async (req: Request, res: Response) => {
  try {
    const businessId = (req as any).businessId;
    const settings = await WhatsAppService.getWhatsAppSettings(businessId);

    res.json({
      success: true,
      settings,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to fetch WhatsApp settings' });
  }
});

/**
 * PUT /api/whatsapp/settings
 * Update WhatsApp business configuration
 */
router.put('/settings', async (req: Request, res: Response) => {
  try {
    const businessId = (req as any).businessId;
    const { autoSendOnSave, autoSendRequireOptIn, messageTemplate, includePdf } = req.body;

    const updated = await WhatsAppService.updateWhatsAppSettings(businessId, {
      autoSendOnSave: typeof autoSendOnSave === 'boolean' ? autoSendOnSave : undefined,
      autoSendRequireOptIn: typeof autoSendRequireOptIn === 'boolean' ? autoSendRequireOptIn : undefined,
      messageTemplate: typeof messageTemplate === 'string' ? messageTemplate : undefined,
      includePdf: typeof includePdf === 'boolean' ? includePdf : undefined,
    });

    res.json({
      success: true,
      message: 'WhatsApp settings saved successfully.',
      settings: updated,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to update WhatsApp settings' });
  }
});

/**
 * GET /api/whatsapp/invoices/:invoiceId/status
 * Get WhatsApp sending status and queue history for an invoice
 */
router.get('/invoices/:invoiceId/status', async (req: Request, res: Response) => {
  try {
    const businessId = (req as any).businessId;
    const { invoiceId } = req.params;

    const statusData = await WhatsAppService.getInvoiceWhatsAppStatus(businessId, invoiceId);

    res.json({
      success: true,
      ...statusData,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to fetch invoice WhatsApp status' });
  }
});

/**
 * POST /api/whatsapp/send-invoice
 * Manual trigger to share/send invoice via WhatsApp
 */
router.post('/send-invoice', async (req: Request, res: Response) => {
  try {
    const businessId = (req as any).businessId;
    const { invoiceId, recipientPhone, recipientName, customMessage, idempotencyKey } = req.body;

    if (!invoiceId) {
      return res.status(400).json({ success: false, error: 'invoiceId is required' });
    }

    // Fetch invoice details
    const invRes = await pool.query(
      `SELECT si.*, p.name as party_name, p.mobile as party_mobile, p.alternate_mobile as party_alt_mobile,
              p.whatsapp_opt_in, b.name as biz_name, b.trade_name as biz_trade_name
       FROM sales_invoices si
       JOIN parties p ON si.party_id = p.id
       JOIN businesses b ON si.business_id = b.id
       WHERE si.business_id = $1 AND si.id = $2`,
      [businessId, invoiceId]
    );

    if (invRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Sales Invoice not found' });
    }

    const inv = invRes.rows[0];
    const settings = await WhatsAppService.getWhatsAppSettings(businessId);

    // Determine target phone
    const rawTargetPhone = recipientPhone || inv.party_mobile || inv.party_alt_mobile;
    const phoneVal = WhatsAppService.normalizePhoneNumber(rawTargetPhone);

    if (!phoneVal.valid) {
      return res.status(400).json({
        success: false,
        error: phoneVal.error || 'Recipient mobile number is invalid',
        rawPhone: rawTargetPhone,
      });
    }

    // Determine message text
    const messageText = customMessage || WhatsAppService.interpolateTemplate(settings.messageTemplate, {
      customer_name: recipientName || inv.party_name,
      business_name: inv.biz_trade_name || inv.biz_name,
      invoice_number: inv.invoice_number,
      invoice_total: inv.grand_total,
      invoice_date: new Date(inv.invoice_date).toLocaleDateString('en-IN'),
    });

    const key = idempotencyKey || `manual-send-${businessId}-${invoiceId}-${Date.now()}`;

    const enqueueResult = await WhatsAppService.enqueueInvoiceMessage({
      businessId,
      invoiceId,
      recipientPartyId: inv.party_id,
      recipientPhone: phoneVal.normalized,
      recipientName: recipientName || inv.party_name,
      messageText,
      mediaFileName: `${inv.invoice_number}.pdf`,
      idempotencyKey: key,
      forceImmediate: true,
    });

    const waMeUrl = WhatsAppService.generateWaMeLink(phoneVal.normalized, messageText);

    res.json({
      success: true,
      message: 'Invoice WhatsApp dispatch initiated',
      waMeUrl,
      result: enqueueResult,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to dispatch invoice over WhatsApp' });
  }
});

/**
 * POST /api/whatsapp/queue/:id/retry
 * Retry a failed message dispatch
 */
router.post('/queue/:id/retry', async (req: Request, res: Response) => {
  try {
    const businessId = (req as any).businessId;
    const { id } = req.params;

    const retryResult = await WhatsAppService.retryQueueItem(businessId, id);

    res.json({
      success: true,
      message: 'Message retry executed',
      result: retryResult,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to retry message' });
  }
});

/**
 * GET /api/whatsapp/wa-link
 * Generate wa.me click-to-chat URL with prefilled text
 */
router.get('/wa-link', (req: Request, res: Response) => {
  const phone = String(req.query.phone || '');
  const text = String(req.query.text || '');

  const norm = WhatsAppService.normalizePhoneNumber(phone);
  const waMeUrl = WhatsAppService.generateWaMeLink(phone, text);

  res.json({
    success: true,
    normalizedPhone: norm.normalized,
    isValidPhone: norm.valid,
    waMeUrl,
  });
});

export default router;
