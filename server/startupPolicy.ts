type StartupDependencies = {
  initializeDatabase: () => Promise<unknown>;
  restoreWhatsAppSessions: () => Promise<unknown>;
  log: (message: string) => void;
};

/** Accounting initialization stays opt-in. Existing WhatsApp auth may reconnect, never send. */
export async function runOptionalStartupActions(
  env: Record<string, string | undefined>,
  dependencies: StartupDependencies,
): Promise<void> {
  if (env.RUN_DATABASE_INITIALIZATION_ON_STARTUP === 'true') {
    await dependencies.initializeDatabase();
  } else {
    dependencies.log('[Startup] Database initialization skipped (default). Run reviewed migrations/seeding separately when authorized.');
  }

  if (env.RESTORE_WHATSAPP_SESSIONS_ON_STARTUP !== 'false') {
    await dependencies.restoreWhatsAppSessions();
  } else {
    dependencies.log('[Startup] Automatic WhatsApp session restore explicitly disabled. Manual connection remains available.');
  }
}
