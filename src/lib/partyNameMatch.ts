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
