import { assertSyntheticDatabase } from './assertSyntheticDatabase.js';
assertSyntheticDatabase();
import { WhatsAppService } from '../services/whatsapp/whatsappService.js';
import { createExpressApp } from '../app.js';
import { runPermissionEnforcementVerification } from './permissionEnforcement.test.js';
import { pool } from '../db/index.js';
const forbiddenCalls: string[] = [];
for (const name of ['initiateLinkSession','requestPairingCode','confirmAuthentication','disconnectSession','testConnection','enqueueInvoiceMessage','dispatchQueueItem','retryQueueItem','updateWhatsAppSettings']) {
  (WhatsAppService as any)[name] = async () => { forbiddenCalls.push(name); throw new Error('ISOLATED_TRANSPORT_TRAP'); };
}
const server = createExpressApp().listen(3000,'127.0.0.1');
try {
  await new Promise<void>(resolve=>server.listening?resolve():server.once('listening',resolve));
  await runPermissionEnforcementVerification();
  if (forbiddenCalls.length) throw new Error('A forbidden WhatsApp method was reached: '+forbiddenCalls.join(','));
  console.log('PASS transport traps armed, zero WhatsApp mutation methods reached');
} finally { await new Promise<void>(resolve=>server.close(()=>resolve())); await pool.end(); }
