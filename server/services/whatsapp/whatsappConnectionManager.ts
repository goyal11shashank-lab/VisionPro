import fs from 'fs';
import path from 'path';
import QRCode from 'qrcode';
import pino from 'pino';
import { db, pool } from '../../db/index.js';
import { whatsappSessions } from '../../db/schema.js';
import { eq } from 'drizzle-orm';

export type WhatsAppConnectionStatus =
  | 'DISCONNECTED'
  | 'INITIALIZING'
  | 'QR_REQUIRED'
  | 'CONNECTED'
  | 'RECONNECTING'
  | 'ERROR';

export interface WhatsAppSessionState {
  businessId: string;
  status: WhatsAppConnectionStatus;
  qrCodeData: string | null;
  qrExpiresAt: Date | null;
  isQrExpired: boolean;
  connectedPhone: string | null;
  connectedPushname: string | null;
  lastConnectedAt: Date | null;
  lastDisconnectedAt: Date | null;
  lastError: string | null;
  reconnectAttempts: number;
}

export interface IWhatsAppSocketTransport {
  user?: { id: string; name?: string; pushname?: string };
  ev: {
    on: (event: string, handler: (...args: any[]) => void) => void;
  };
  logout: () => Promise<void>;
  end: (error?: Error) => void;
}

export type WhatsAppTransportFactory = (params: {
  businessId: string;
  sessionDir: string;
  authState: any;
  saveCreds: () => Promise<void>;
}) => Promise<IWhatsAppSocketTransport>;

const SESSIONS_BASE_DIR = path.join(process.cwd(), '.whatsapp-sessions');
const MAX_RECONNECT_ATTEMPTS = 5;
const QR_EXPIRY_SECONDS = 90;

/**
 * Default production transport using @whiskeysockets/baileys
 */
const defaultBaileysFactory: WhatsAppTransportFactory = async ({
  sessionDir,
  authState,
  saveCreds,
}) => {
  const baileys: any = await import('@whiskeysockets/baileys');
  const makeWASocket = baileys.default?.default || baileys.default || baileys.makeWASocket;
  const logger = pino({ level: 'silent' });

  const sock = makeWASocket({
    auth: authState.state,
    logger,
    printQRInTerminal: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
    connectTimeoutMs: 60000,
    keepAliveIntervalMs: 25000,
    browser: ['Optical ERP', 'Desktop', '1.0.0'],
  });

  sock.ev.on('creds.update', async () => {
    try {
      await saveCreds();
    } catch (err) {
      console.error('[WhatsApp creds.update error]', err);
    }
  });

  return sock;
};

interface ActiveClient {
  businessId: string;
  socket: IWhatsAppSocketTransport | null;
  status: WhatsAppConnectionStatus;
  qrCodeData: string | null;
  rawQr: string | null;
  qrExpiresAt: Date | null;
  reconnectAttempts: number;
  reconnectTimer: NodeJS.Timeout | null;
  connectedPhone: string | null;
  connectedPushname: string | null;
  lastConnectedAt: Date | null;
  lastDisconnectedAt: Date | null;
  lastError: string | null;
  isInitializing: boolean;
}

export class WhatsAppConnectionManager {
  private static clients: Map<string, ActiveClient> = new Map();
  private static locks: Map<string, Promise<any>> = new Map();
  private static transportFactory: WhatsAppTransportFactory = defaultBaileysFactory;

  /**
   * Override transport factory for unit / integration tests
   */
  static setTransportFactory(factory: WhatsAppTransportFactory) {
    this.transportFactory = factory;
  }

  static resetTransportFactory() {
    this.transportFactory = defaultBaileysFactory;
  }

  /**
   * Returns directory path for a specific business's session credentials
   */
  static getSessionDir(businessId: string): string {
    return path.join(SESSIONS_BASE_DIR, businessId);
  }

  /**
   * Checks if valid credentials exist on disk for a business
   */
  static hasStoredCredentials(businessId: string): boolean {
    const sessionDir = this.getSessionDir(businessId);
    const credsPath = path.join(sessionDir, 'creds.json');
    return fs.existsSync(credsPath);
  }

  /**
   * Safely removes session directory and all secrets from disk
   */
  static clearStoredCredentials(businessId: string): void {
    const sessionDir = this.getSessionDir(businessId);
    try {
      if (fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
      }
    } catch (err) {
      console.error(`[WhatsApp] Failed to clear session dir for ${businessId}:`, err);
    }
  }

  /**
   * Internal mutex wrapper to prevent concurrent connects for the same business
   */
  private static async withLock<T>(businessId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(businessId) || Promise.resolve();
    let resolveLock: () => void;
    const current = new Promise<void>((res) => {
      resolveLock = res;
    });
    this.locks.set(businessId, current);

    try {
      await prev;
      return await fn();
    } finally {
      resolveLock!();
      if (this.locks.get(businessId) === current) {
        this.locks.delete(businessId);
      }
    }
  }

  /**
   * Persists connection state to the Neon PostgreSQL database
   */
  private static async syncToDatabase(client: ActiveClient): Promise<void> {
    try {
      await pool.query(
        `INSERT INTO whatsapp_sessions (
           business_id, status, qr_code_data, qr_expires_at,
           connected_phone, connected_pushname, last_connected_at,
           last_disconnected_at, last_error, session_metadata, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
         ON CONFLICT (business_id) DO UPDATE SET
           status = $2,
           qr_code_data = $3,
           qr_expires_at = $4,
           connected_phone = $5,
           connected_pushname = $6,
           last_connected_at = COALESCE($7, whatsapp_sessions.last_connected_at),
           last_disconnected_at = $8,
           last_error = $9,
           session_metadata = $10,
           updated_at = NOW()`,
        [
          client.businessId,
          client.status,
          client.qrCodeData,
          client.qrExpiresAt,
          client.connectedPhone,
          client.connectedPushname,
          client.lastConnectedAt,
          client.lastDisconnectedAt,
          client.lastError,
          JSON.stringify({
            reconnectAttempts: client.reconnectAttempts,
            lastStatusUpdate: new Date().toISOString(),
          }),
        ]
      );
    } catch (err: any) {
      console.error(`[WhatsApp DB Sync Error for ${client.businessId}]:`, err.message);
    }
  }

  /**
   * Retrieves or builds memory state for a business
   */
  private static getOrCreateClient(businessId: string): ActiveClient {
    let client = this.clients.get(businessId);
    if (!client) {
      client = {
        businessId,
        socket: null,
        status: 'DISCONNECTED',
        qrCodeData: null,
        rawQr: null,
        qrExpiresAt: null,
        reconnectAttempts: 0,
        reconnectTimer: null,
        connectedPhone: null,
        connectedPushname: null,
        lastConnectedAt: null,
        lastDisconnectedAt: null,
        lastError: null,
        isInitializing: false,
      };
      this.clients.set(businessId, client);
    }
    return client;
  }

  /**
   * Starts or restarts WhatsApp connection for a business
   */
  static async connect(businessId: string, forceNew: boolean = false): Promise<WhatsAppSessionState> {
    return this.withLock(businessId, async () => {
      const client = this.getOrCreateClient(businessId);

      // If already connected and not forcing new link, return current state
      if (client.status === 'CONNECTED' && client.socket && !forceNew) {
        return this.getStatus(businessId);
      }

      // If forceNew is requested, clear old credentials
      if (forceNew) {
        this.clearStoredCredentials(businessId);
      }

      // Clear existing socket & timers
      if (client.reconnectTimer) {
        clearTimeout(client.reconnectTimer);
        client.reconnectTimer = null;
      }

      if (client.socket) {
        try {
          client.socket.end();
        } catch {}
        client.socket = null;
      }

      client.status = 'INITIALIZING';
      client.qrCodeData = null;
      client.rawQr = null;
      client.qrExpiresAt = null;
      client.lastError = null;
      client.isInitializing = true;
      await this.syncToDatabase(client);

      const sessionDir = this.getSessionDir(businessId);
      if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
      }

      try {
        const baileys: any = await import('@whiskeysockets/baileys');
        const useMultiFileAuthState = baileys.default?.useMultiFileAuthState || baileys.useMultiFileAuthState;

        const authState = await useMultiFileAuthState(sessionDir);

        const socket = await this.transportFactory({
          businessId,
          sessionDir,
          authState,
          saveCreds: authState.saveCreds,
        });

        client.socket = socket;
        client.isInitializing = false;

        // Register connection.update listener
        socket.ev.on('connection.update', async (update: any) => {
          await this.handleConnectionUpdate(businessId, update);
        });

        return this.getStatus(businessId);
      } catch (err: any) {
        client.status = 'ERROR';
        client.lastError = err.message || 'Failed to initialize WhatsApp socket';
        client.isInitializing = false;
        await this.syncToDatabase(client);
        throw err;
      }
    });
  }

  /**
   * Handles Baileys connection.update events
   */
  private static async handleConnectionUpdate(businessId: string, update: any) {
    const client = this.clients.get(businessId);
    if (!client) return;

    const { connection, lastDisconnect, qr } = update;

    // 1. QR Challenge emitted
    if (qr) {
      client.rawQr = qr;
      client.status = 'QR_REQUIRED';
      const expiresAt = new Date(Date.now() + QR_EXPIRY_SECONDS * 1000);
      client.qrExpiresAt = expiresAt;

      try {
        client.qrCodeData = await QRCode.toDataURL(qr, {
          width: 320,
          margin: 2,
          color: {
            dark: '#0f172a',
            light: '#ffffff',
          },
        });
      } catch (err: any) {
        console.error(`[WhatsApp] Failed to generate QR data URL:`, err);
        client.qrCodeData = null;
      }

      await this.syncToDatabase(client);
    }

    // 2. Connection open (authenticated and ready)
    if (connection === 'open') {
      client.status = 'CONNECTED';
      client.qrCodeData = null;
      client.rawQr = null;
      client.qrExpiresAt = null;
      client.lastError = null;
      client.reconnectAttempts = 0;
      client.lastConnectedAt = new Date();

      // Extract connected user info
      if (client.socket?.user) {
        const rawId = client.socket.user.id || '';
        const phoneDigits = rawId.split(':')[0].replace(/\D/g, '');
        client.connectedPhone = phoneDigits ? `+${phoneDigits}` : null;
        client.connectedPushname =
          client.socket.user.name || client.socket.user.pushname || 'Connected WhatsApp Account';
      }

      await this.syncToDatabase(client);
    }

    // 3. Connection closed / disconnected
    if (connection === 'close') {
      const statusCode =
        lastDisconnect?.error?.output?.statusCode ||
        lastDisconnect?.error?.statusCode ||
        (lastDisconnect?.error as any)?.status;

      const baileys: any = await import('@whiskeysockets/baileys');
      const DisconnectReason = baileys.default?.DisconnectReason || baileys.DisconnectReason;
      const isLoggedOut = statusCode === DisconnectReason?.loggedOut || statusCode === 401 || statusCode === 403;

      client.lastDisconnectedAt = new Date();

      if (isLoggedOut) {
        // Phone revoked session or unrecoverable logout
        client.status = 'DISCONNECTED';
        client.lastError = 'Session logged out from mobile phone';
        client.connectedPhone = null;
        client.connectedPushname = null;
        client.qrCodeData = null;
        client.qrExpiresAt = null;
        client.socket = null;

        // Clear invalid credentials
        this.clearStoredCredentials(businessId);
        await this.syncToDatabase(client);
      } else {
        // Temporary network or server restart disconnect: attempt controlled exponential backoff
        if (client.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          client.status = 'RECONNECTING';
          client.reconnectAttempts += 1;
          const delayMs = Math.min(1000 * Math.pow(2, client.reconnectAttempts), 30000);
          client.lastError = `Connection lost. Reconnecting in ${Math.round(delayMs / 1000)}s (Attempt ${client.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`;

          await this.syncToDatabase(client);

          client.reconnectTimer = setTimeout(async () => {
            try {
              await this.connect(businessId, false);
            } catch (err: any) {
              console.warn(`[WhatsApp Reconnect Failed for ${businessId}]:`, err.message);
            }
          }, delayMs);
        } else {
          // Reconnection limit exceeded
          client.status = 'ERROR';
          client.lastError = `Connection terminated after ${MAX_RECONNECT_ATTEMPTS} failed reconnect attempts. Please reconnect manually.`;
          client.socket = null;
          await this.syncToDatabase(client);
        }
      }
    }
  }

  /**
   * Sets session to connected directly (used by auth confirmation & testing)
   */
  static setConnected(businessId: string, phone: string, pushname: string) {
    const client = this.getOrCreateClient(businessId);
    client.status = 'CONNECTED';
    client.connectedPhone = phone;
    client.connectedPushname = pushname;
    client.qrCodeData = null;
    client.qrExpiresAt = null;
    client.lastError = null;
    client.lastConnectedAt = new Date();
  }

  /**
   * Disconnects current WhatsApp session and clears local credentials
   */
  static async disconnect(businessId: string): Promise<WhatsAppSessionState> {
    return this.withLock(businessId, async () => {
      const client = this.getOrCreateClient(businessId);

      if (client.reconnectTimer) {
        clearTimeout(client.reconnectTimer);
        client.reconnectTimer = null;
      }

      if (client.socket) {
        try {
          await client.socket.logout().catch(() => {});
          client.socket.end();
        } catch {}
        client.socket = null;
      }

      // Clear disk credentials
      this.clearStoredCredentials(businessId);

      client.status = 'DISCONNECTED';
      client.qrCodeData = null;
      client.rawQr = null;
      client.qrExpiresAt = null;
      client.connectedPhone = null;
      client.connectedPushname = null;
      client.reconnectAttempts = 0;
      client.lastDisconnectedAt = new Date();
      client.lastError = null;

      await this.syncToDatabase(client);
      return this.getStatus(businessId);
    });
  }

  /**
   * Gets current session state for a business, checking memory or database
   */
  static async getStatus(businessId: string): Promise<WhatsAppSessionState> {
    let client = this.clients.get(businessId);

    if (!client) {
      // Check database
      const [dbRow] = await db
        .select()
        .from(whatsappSessions)
        .where(eq(whatsappSessions.businessId, businessId))
        .limit(1);

      if (dbRow) {
        // Map database status
        let mappedStatus: WhatsAppConnectionStatus = 'DISCONNECTED';
        if (dbRow.status === 'CONNECTED') mappedStatus = 'CONNECTED';
        else if (dbRow.status === 'QR_REQUIRED' || dbRow.status === 'CONNECTING') mappedStatus = 'QR_REQUIRED';
        else if (dbRow.status === 'INITIALIZING') mappedStatus = 'INITIALIZING';
        else if (dbRow.status === 'RECONNECTING') mappedStatus = 'RECONNECTING';
        else if (dbRow.status === 'ERROR') mappedStatus = 'ERROR';

        client = {
          businessId,
          socket: null,
          status: mappedStatus,
          qrCodeData: dbRow.qrCodeData,
          rawQr: null,
          qrExpiresAt: dbRow.qrExpiresAt ? new Date(dbRow.qrExpiresAt) : null,
          reconnectAttempts: (dbRow.sessionMetadata as any)?.reconnectAttempts || 0,
          reconnectTimer: null,
          connectedPhone: dbRow.connectedPhone,
          connectedPushname: dbRow.connectedPushname,
          lastConnectedAt: dbRow.lastConnectedAt ? new Date(dbRow.lastConnectedAt) : null,
          lastDisconnectedAt: dbRow.lastDisconnectedAt ? new Date(dbRow.lastDisconnectedAt) : null,
          lastError: dbRow.lastError,
          isInitializing: false,
        };
        this.clients.set(businessId, client);
      } else {
        client = this.getOrCreateClient(businessId);
      }
    }

    const isQrExpired = !!(client.qrExpiresAt && client.qrExpiresAt.getTime() < Date.now());

    // If QR expired in memory, nullify QR data
    if (isQrExpired && client.status === 'QR_REQUIRED') {
      client.qrCodeData = null;
    }

    return {
      businessId: client.businessId,
      status: client.status,
      qrCodeData: isQrExpired ? null : client.qrCodeData,
      qrExpiresAt: client.qrExpiresAt,
      isQrExpired,
      connectedPhone: client.connectedPhone,
      connectedPushname: client.connectedPushname,
      lastConnectedAt: client.lastConnectedAt,
      lastDisconnectedAt: client.lastDisconnectedAt,
      lastError: client.lastError,
      reconnectAttempts: client.reconnectAttempts,
    };
  }

  /**
   * Retrieves current QR challenge when required
   */
  static async getQR(businessId: string) {
    const status = await this.getStatus(businessId);
    const expiresInSeconds = status.qrExpiresAt
      ? Math.max(0, Math.floor((status.qrExpiresAt.getTime() - Date.now()) / 1000))
      : 0;

    return {
      status: status.status,
      qrCodeData: status.qrCodeData,
      qrExpiresAt: status.qrExpiresAt,
      expiresInSeconds,
      isExpired: status.isQrExpired || expiresInSeconds === 0,
    };
  }

  /**
   * Restores all valid persistent sessions on server startup
   */
  static async restoreAllSessions(): Promise<void> {
    try {
      // Find all sessions that were CONNECTED or have stored credentials
      const rows = await db.select().from(whatsappSessions);

      for (const row of rows) {
        const hasCreds = this.hasStoredCredentials(row.businessId);
        if (row.status === 'CONNECTED' || hasCreds) {
          console.log(`[WhatsApp Startup] Restoring session for business ${row.businessId}...`);
          try {
            await this.connect(row.businessId, false);
          } catch (err: any) {
            console.error(`[WhatsApp Startup] Failed to restore session for ${row.businessId}:`, err.message);
          }
        }
      }
    } catch (err: any) {
      console.error('[WhatsApp Startup Error]:', err.message);
    }
  }

  /**
   * Closes all active connections gracefully on process shutdown
   */
  static async shutdown(): Promise<void> {
    console.log('[WhatsApp] Shutting down all active WhatsApp sockets...');
    for (const [businessId, client] of this.clients.entries()) {
      if (client.reconnectTimer) {
        clearTimeout(client.reconnectTimer);
      }
      if (client.socket) {
        try {
          client.socket.end();
        } catch {}
      }
    }
    this.clients.clear();
  }
}
