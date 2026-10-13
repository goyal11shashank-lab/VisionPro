import * as XLSX from 'xlsx';

const TOKEN_KEY = 'optical_erp_token';
const LEGACY_TOKEN_KEY = 'token';
const BIZ_KEY = 'optical_erp_active_biz';
const LEGACY_BIZ_KEY = 'currentBusinessId';

// Pre-set AI Studio iframe test cookie to ensure cross-origin/iframe proxy requests pass through
if (typeof document !== 'undefined') {
  try {
    document.cookie = '__SECURE-aistudio_auth_flow_may_set_cookies=true; Path=/; Secure; SameSite=None; Partitioned; Max-Age=86400;';
  } catch {
    // Non-fatal if cookies are restricted
  }
}

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
  retries = 5
): Promise<T> {
  const token = getStoredToken();
  const bizId = getStoredBusinessId();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (!headers['Authorization'] && token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (!headers['X-Business-Id'] && bizId) {
    headers['X-Business-Id'] = bizId;
  }

  // For FormData bodies (file uploads), do NOT specify Content-Type so browser sets multipart boundary
  if (options.body instanceof FormData) {
    delete headers['Content-Type'];
  }

  let attempt = 0;
  while (true) {
    attempt++;
    try {
      const response = await fetch(endpoint, {
        credentials: 'include',
        ...options,
        headers,
      });

      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      let data: any = {};

      if (contentType.includes('application/json')) {
        const text = await response.text().catch(() => '');
        try {
          data = text ? JSON.parse(text) : {};
        } catch (jsonErr) {
          // In case header was JSON but body was malformed or HTML
          console.error(`[API Client JSON Parse Error] ${endpoint}:`, text.slice(0, 300));
          if (text.startsWith('<') || text.includes('<html') || text.includes('Cookie check')) {
            if (typeof document !== 'undefined') {
              try {
                document.cookie = '__SECURE-aistudio_auth_flow_may_set_cookies=true; Path=/; Secure; SameSite=None; Partitioned; Max-Age=86400;';
              } catch {
                // Ignore
              }
            }
            if (attempt <= retries) {
              await new Promise((resolve) => setTimeout(resolve, Math.min(attempt * 600, 2500)));
              continue;
            }
            const msg = endpoint.includes('/imports')
              ? 'The import service returned an unexpected HTML response. Please check the API endpoint or server logs.'
              : `HTTP ${response.status}: The server returned an unexpected HTML response instead of JSON.`;
            const err: any = new Error(msg);
            err.status = response.status;
            err.rawResponse = text;
            throw err;
          }
          data = {};
        }
      } else {
        const text = await response.text().catch(() => '');
        const isHtml = text.startsWith('<!doctype') || text.startsWith('<html') || text.trim().startsWith('<') || text.includes('Starting Server...') || text.includes('Cookie check');
        
        if (isHtml && (text.includes('Cookie check') || text.includes('aistudio_auth'))) {
          if (typeof document !== 'undefined') {
            try {
              document.cookie = '__SECURE-aistudio_auth_flow_may_set_cookies=true; Path=/; Secure; SameSite=None; Partitioned; Max-Age=86400;';
            } catch {
              // Ignore
            }
          }
        }

        // If the server is warming up or cookie check is needed, retry up to `retries` times
        if (isHtml && attempt <= retries) {
          console.warn(`[API Client] Endpoint ${endpoint} returned HTML (warming up or cookie check). Retrying attempt ${attempt}/${retries}...`);
          await new Promise((resolve) => setTimeout(resolve, Math.min(attempt * 600, 2500)));
          continue;
        }

        if (!response.ok) {
          if ((response.status === 502 || response.status === 503 || response.status === 504) && attempt <= retries) {
            console.warn(`[API Client] Gateway ${response.status} on ${endpoint}. Retrying attempt ${attempt}/${retries}...`);
            await new Promise((resolve) => setTimeout(resolve, Math.min(attempt * 600, 2500)));
            continue;
          }
          if (isHtml) {
            console.error(`[API Client Non-JSON Error] ${endpoint} returned HTML:`, text.slice(0, 500));
            const msg = endpoint.includes('/imports')
              ? 'The import service returned an unexpected HTML response. Please check the API endpoint or server logs.'
              : `HTTP ${response.status}: The server returned an unexpected HTML response instead of JSON.`;
            const err: any = new Error(msg);
            err.status = response.status;
            err.rawResponse = text;
            throw err;
          }
          const err: any = new Error(`HTTP ${response.status}: Request failed`);
          err.status = response.status;
          err.data = text;
          throw err;
        }

        if (isHtml) {
          if (attempt <= retries) {
            console.warn(`[API Client] Endpoint ${endpoint} returned HTML. Retrying attempt ${attempt}/${retries}...`);
            await new Promise((resolve) => setTimeout(resolve, Math.min(attempt * 600, 2500)));
            continue;
          }
          console.error(`[API Client Unexpected HTML] ${endpoint}:`, text.slice(0, 500));
          const msg = endpoint.includes('/imports')
            ? 'The import service returned an unexpected HTML response. Please check the API endpoint or server logs.'
            : `API endpoint ${endpoint} returned HTML instead of JSON. The server may still be initializing.`;
          const err: any = new Error(msg);
          err.status = 502;
          err.rawResponse = text;
          throw err;
        }
      }

      if (!response.ok) {
        if ((response.status === 502 || response.status === 503 || response.status === 504) && attempt <= retries) {
          console.warn(`[API Client] Gateway error HTTP ${response.status} on ${endpoint}. Retrying attempt ${attempt}/${retries}...`);
          await new Promise((resolve) => setTimeout(resolve, Math.min(attempt * 600, 2500)));
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
      if (attempt <= retries && (networkErr.message?.includes('Failed to fetch') || networkErr.status === 502 || networkErr.name === 'TypeError')) {
        console.warn(`[API Client] Network or initialization error on ${endpoint}. Retrying attempt ${attempt}/${retries}...`);
        await new Promise((resolve) => setTimeout(resolve, Math.min(attempt * 600, 2500)));
        continue;
      }
      throw networkErr;
    }
  }
}

/**
 * Converts a browser Blob or File into a base64 encoded string
 */
export async function fileBlobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = reader.result as string;
      const base64 = res.includes(',') ? res.split(',')[1] : res;
      resolve(base64);
    };
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(blob);
  });
}

/**
 * Upload helper that transmits payloads while ensuring authentication headers,
 * business context, retry logic, and non-JSON protection.
 * Automatically serializes File/Blob payloads to JSON Base64 and pre-parsed sheet rows
 * when in browser iframe environments to prevent stream locking/consumption issues.
 */
export async function apiUpload<T = any>(
  endpoint: string,
  formData: FormData,
  retries = 3
): Promise<T> {
  try {
    if (typeof FormData !== 'undefined' && formData instanceof FormData) {
      const fileEntry = formData.get('file');
      if (fileEntry && (fileEntry instanceof Blob || typeof (fileEntry as any).arrayBuffer === 'function')) {
        const fileObj = fileEntry as File;

        // Try extracting pre-parsed rows using XLSX if it's a spreadsheet
        let parsedRows: any[] | null = null;
        try {
          if (fileObj.name && /\.(xlsx|xls|csv)$/i.test(fileObj.name)) {
            const buffer = await fileObj.arrayBuffer();
            const wb = XLSX.read(buffer, { type: 'array' });
            const firstSheetName = wb.SheetNames[0];
            if (firstSheetName) {
              const ws = wb.Sheets[firstSheetName];
              parsedRows = XLSX.utils.sheet_to_json(ws, { defval: '' });
            }
          }
        } catch (parseErr) {
          console.warn('[apiUpload] Pre-parsing sheet skipped:', parseErr);
        }

        const base64 = await fileBlobToBase64(fileObj);
        const payload: Record<string, any> = {
          fileBase64: base64,
          fileName: fileObj.name || 'upload.xlsx',
          fileSize: fileObj.size || 0,
        };

        if (parsedRows && parsedRows.length > 0) {
          payload.rows = parsedRows;
        }

        // Transfer any extra form fields (e.g. importType, importMode, columnMapping)
        formData.forEach((value, key) => {
          if (key !== 'file') {
            payload[key] = value;
          }
        });

        return await apiRequest<T>(
          endpoint,
          {
            method: 'POST',
            body: JSON.stringify(payload),
          },
          retries
        );
      }
    }
  } catch (serializationErr) {
    console.warn('[apiUpload] JSON serialization skipped, falling back to standard FormData:', serializationErr);
  }

  // Fallback to standard multipart FormData
  return apiRequest<T>(
    endpoint,
    {
      method: 'POST',
      body: formData,
    },
    retries
  );
}
