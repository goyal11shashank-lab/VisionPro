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
  options: RequestInit = {}
): Promise<T> {
  const token = getStoredToken();
  const bizId = getStoredBusinessId();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (bizId) {
    headers['X-Business-Id'] = bizId;
  }

  const response = await fetch(endpoint, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errorMsg = data.message || data.error || `HTTP ${response.status}: Request failed`;
    const err: any = new Error(errorMsg);
    err.status = response.status;
    err.data = data;
    throw err;
  }

  return data as T;
}
