export function assertWhatsAppSendAllowed(phone: string, env: Record<string, string | undefined> = process.env): void {
  if (env.WHATSAPP_SEND_ENABLED !== 'true') {
    throw new Error('WhatsApp sending is disabled by the server safety gate.');
  }
  if (!/^\+?[\d\s()-]+$/.test(phone)) throw new Error('Invalid WhatsApp recipient format.');
  const digits = (value: string) => {
    const d = value.replace(/\D/g, '');
    return d.length === 10 ? `91${d}` : d;
  };
  const allowed = env.WHATSAPP_TEST_RECIPIENT?.trim();
  if (allowed && digits(phone) !== digits(allowed)) {
    throw new Error('WhatsApp test mode allows only the approved test recipient. Customer sends are blocked.');
  }
}
