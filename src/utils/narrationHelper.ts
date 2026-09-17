/**
 * Helper utility for cleaning up voucher narration/remarks
 * Removes unwanted payment mode and terms text patterns
 */

export function cleanNarrationNotes(notes?: string | null): string {
  if (!notes) return '';
  return notes
    .replace(/(?:\|\s*)?Payment Mode:\s*[^|]+/gi, '')
    .replace(/(?:\|\s*)?Terms:\s*[^|]+/gi, '')
    .replace(/\|\s*\|+/g, '|')
    .replace(/^[\s|]+|[\s|]+$/g, '')
    .trim();
}
