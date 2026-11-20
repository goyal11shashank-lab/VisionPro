export function assertSyntheticDatabase() {
  const url = new URL(process.env.DATABASE_URL || '');
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/erp_tenant_synth') {
    throw new Error('This destructive regression suite requires the disposable local erp_tenant_synth database.');
  }
}
