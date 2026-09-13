const TOKEN_KEY = 'optical_erp_token';
const LEGACY_TOKEN_KEY = 'token';
const BIZ_KEY = 'optical_erp_active_biz';
const LEGACY_BIZ_KEY = 'currentBusinessId';

// Synchronize legacy and current storage keys on script load in browser
if (typeof window !== 'undefined' && window.localStorage) {
  try {
    const t1 = localStorage.getItem(TOKEN_KEY);
    const t2 = localStorage.getItem(LEGACY_TOKEN_KEY);
    if (t1 && !t2) {
      localStorage.setItem(LEGACY_TOKEN_KEY, t1);
    } else if (!t1 && t2) {
      localStorage.setItem(TOKEN_KEY, t2);
    }

    const b1 = localStorage.getItem(BIZ_KEY);
    const b2 = localStorage.getItem(LEGACY_BIZ_KEY);
    if (b1 && !b2) {
      localStorage.setItem(LEGACY_BIZ_KEY, b1);
    } else if (!b1 && b2) {
      localStorage.setItem(BIZ_KEY, b2);
    }
  } catch (e) {
    // Non-fatal if localStorage is restricted
  }
}

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY) || localStorage.getItem(LEGACY_TOKEN_KEY);
}

export function setStoredToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(LEGACY_TOKEN_KEY, token);
}

export function removeStoredToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(LEGACY_TOKEN_KEY);
  localStorage.removeItem(BIZ_KEY);
  localStorage.removeItem(LEGACY_BIZ_KEY);
}

export function getStoredBusinessId(): string | null {
  return localStorage.getItem(BIZ_KEY) || localStorage.getItem(LEGACY_BIZ_KEY);
}

export function setStoredBusinessId(bizId: string): void {
  localStorage.setItem(BIZ_KEY, bizId);
  localStorage.setItem(LEGACY_BIZ_KEY, bizId);
}

export function getAuthHeaders(customBizId?: string): Record<string, string> {
  const token = getStoredToken();
  const bizId = customBizId || getStoredBusinessId();
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (bizId) {
    headers['X-Business-Id'] = bizId;
  }
  return headers;
}

export async function apiRequest<T = any>(
  endpoint: string,
  options: RequestInit = {},
  retries = 3
): Promise<T> {
  const token = getStoredToken();
  const bizId = getStoredBusinessId();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (bizId) {
    headers['X-Business-Id'] = bizId;
  }

  let attempt = 0;
  while (true) {
    attempt++;
    try {
      const response = await fetch(endpoint, {
        ...options,
        headers,
      });

      const contentType = response.headers.get('content-type') || '';
      let data: any = {};

      if (contentType.includes('application/json')) {
        data = await response.json().catch(() => ({}));
      } else {
        const text = await response.text().catch(() => '');
        const isHtml = text.startsWith('<!doctype') || text.startsWith('<html') || text.trim().startsWith('<') || text.includes('Starting Server...');
        
        // If the server is warming up or restarting and returned HTML, retry up to `retries` times
        if (isHtml && attempt <= retries) {
          console.warn(`[API Client] Endpoint ${endpoint} returned HTML (server warming up). Retrying attempt ${attempt}/${retries}...`);
          await new Promise((resolve) => setTimeout(resolve, attempt * 500));
          continue;
        }

        if (!response.ok) {
          if ((response.status === 502 || response.status === 503 || response.status === 504) && attempt <= retries) {
            console.warn(`[API Client] Gateway ${response.status} on ${endpoint}. Retrying attempt ${attempt}/${retries}...`);
            await new Promise((resolve) => setTimeout(resolve, attempt * 500));
            continue;
          }
          const err: any = new Error(`HTTP ${response.status}: Request failed`);
          err.status = response.status;
          err.data = text;
          throw err;
        }

        if (isHtml) {
          const err: any = new Error(`API endpoint ${endpoint} returned HTML instead of JSON. The server may still be initializing.`);
          err.status = 502;
          err.data = text;
          throw err;
        }
      }

      if (!response.ok) {
        if ((response.status === 502 || response.status === 503 || response.status === 504) && attempt <= retries) {
          console.warn(`[API Client] Gateway error HTTP ${response.status} on ${endpoint}. Retrying attempt ${attempt}/${retries}...`);
          await new Promise((resolve) => setTimeout(resolve, attempt * 500));
          continue;
        }
        const errorMsg = data.message || data.error || `HTTP ${response.status}: Request failed`;
        const err: any = new Error(errorMsg);
        err.status = response.status;
        err.data = data;
        throw err;
      }

      return data as T;
    } catch (networkErr: any) {
      if (attempt <= retries && (networkErr.message?.includes('Failed to fetch') || networkErr.status === 502)) {
        console.warn(`[API Client] Network error on ${endpoint}. Retrying attempt ${attempt}/${retries}...`);
        await new Promise((resolve) => setTimeout(resolve, attempt * 500));
        continue;
      }
      throw networkErr;
    }
  }
}
