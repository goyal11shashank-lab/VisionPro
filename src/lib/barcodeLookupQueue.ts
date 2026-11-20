import { apiRequest } from '../api/client';

type LookupResult = { d: any } | { err: Error };
type Kind = 'sales' | 'purchases';

const TTL_MS = 15000;
const MAX_CACHE = 500;

function activeBusiness(): string {
  try {
    return localStorage.getItem('optical_erp_active_biz') || localStorage.getItem('currentBusinessId') || '';
  } catch {
    return '';
  }
}

/**
 * Fast barcode lookup for continuous scanning.
 * - Scans that arrive while a request is in flight are sent together in ONE batch request (one auth
 *   round trip for the whole burst) instead of one request per scan.
 * - Successful results are cached per business for a few seconds so repeat scans of the same barcode
 *   apply instantly. The cache is cleared when the business changes. Stock shown is at most TTL old; the
 *   server still validates stock when the voucher is saved.
 * Read-only.
 */
export function createBarcodeLookup(kind: Kind) {
  const cache = new Map<string, { at: number; d: any }>();
  let cacheBiz = activeBusiness();
  let queue: { code: string; resolve: (r: LookupResult) => void }[] = [];
  let inFlight = false;

  const flush = async () => {
    if (inFlight || queue.length === 0) return;
    inFlight = true;
    const batch = queue;
    queue = [];
    const biz = activeBusiness();
    try {
      const codes = Array.from(new Set(batch.map(b => b.code)));
      const res = await apiRequest<{ results: Record<string, { data?: any; error?: string }> }>(
        `/api/${kind}/barcode-lookup-batch`,
        { method: 'POST', body: JSON.stringify({ codes }) }
      );
      for (const b of batch) {
        const r = res.results?.[b.code];
        if (r?.data) {
          if (activeBusiness() === biz) {
            if (cache.size >= MAX_CACHE) cache.clear();
            cache.set(biz + '|' + b.code.toLowerCase(), { at: Date.now(), d: r.data });
          }
          b.resolve({ d: r.data });
        } else {
          b.resolve({ err: new Error(r?.error || `No optical batch found with barcode '${b.code}'`) });
        }
      }
    } catch (err: any) {
      for (const b of batch) b.resolve({ err });
    } finally {
      inFlight = false;
      void flush();
    }
  };

  return (code: string): Promise<LookupResult> => {
    const biz = activeBusiness();
    if (biz !== cacheBiz) {
      cache.clear();
      cacheBiz = biz;
    }
    const hit = cache.get(biz + '|' + code.toLowerCase());
    if (hit && Date.now() - hit.at < TTL_MS) return Promise.resolve({ d: hit.d });
    return new Promise(resolve => {
      queue.push({ code, resolve });
      void flush();
    });
  };
  }
