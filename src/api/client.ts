const TOKEN_KEY = 'optical_erp_token';
const BIZ_KEY = 'optical_erp_active_biz';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function removeStoredToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(BIZ_KEY);
}

export function getStoredBusinessId(): string | null {
  return localStorage.getItem(BIZ_KEY);
}

export function setStoredBusinessId(bizId: string): void {
  localStorage.setItem(BIZ_KEY, bizId);
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
