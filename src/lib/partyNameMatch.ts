/**
 * Resolve a typed party name to exactly one party of the current business.
 * Only an exact name match (case and extra spaces ignored) that identifies a single party counts.
 * Partial matches and duplicate names never auto-link, so a receipt cannot land on a wrong party.
 * This links the receipt to the party only. It never picks invoices to settle.
 */
export interface NamedParty { id: string; name?: string | null }

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

export function resolveUniquePartyByName<T extends NamedParty>(parties: T[], typed: string): T | null {
  const q = norm(typed || '');
  if (!q) return null;
  const hits = parties.filter(p => norm(p.name || '') === q);
  return hits.length === 1 ? hits[0] : null;
}

/**
 * A server search result for the exact typed text. It only counts when it covered every match
 * (complete) and was run for the same text that is typed now (stale results are ignored).
 */
export interface ServerNameCheck<T extends NamedParty> { query: string; complete: boolean; parties: T[] }

/**
 * Auto-link only when the typed name identifies one party across BOTH the fetched list and a
 * complete server search for that same text. If the server check is missing, stale, failed or
 * truncated, nothing links and the user picks from the panel. Duplicate names never link.
 */
export function resolveConfirmedPartyByName<T extends NamedParty>(local: T[], typed: string, check: ServerNameCheck<T> | null): T | null {
  const q = norm(typed || '');
  if (!q || !check || !check.complete || norm(check.query) !== q) return null;
  const byId = new Map<string, T>();
  for (const p of [...local, ...check.parties]) byId.set(p.id, p);
  return resolveUniquePartyByName(Array.from(byId.values()), typed);
}
