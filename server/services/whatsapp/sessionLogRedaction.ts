/** libsignal 6 prints whole cryptographic session objects through console.
 * Keep lifecycle diagnostics, never the trailing session-state arguments.
 * Exact prefixes avoid muting unrelated application warnings and errors.
 */
const sensitiveSessionPrefixes = new Set([
  'Closing session:',
  'Opening session:',
  'Session already closed',
  'Removing old closed session:',
]);
export function installSessionLogRedaction(target: Pick<Console, 'info' | 'warn'> = console): void {
  for (const level of ['info', 'warn'] as const) {
    const original = target[level].bind(target);
    target[level] = (...args: unknown[]) => {
      if (typeof args[0] === 'string' && sensitiveSessionPrefixes.has(args[0])) {
        original('[WhatsApp crypto] Session lifecycle event (details redacted)');
      } else {
        original(...args);
      }
    };
  }
}
installSessionLogRedaction();
