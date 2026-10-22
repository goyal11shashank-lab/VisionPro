/**
 * Scoped Local Storage Draft Persistence and Recovery
 * Stores minimal necessary voucher draft data scoped to current business, authenticated user,
 * and voucher identity. Never stores tokens, passwords, or sensitive credentials.
 */

import { VoucherFormState, normalizeVoucherSnapshot } from './voucherDirtyHelper.js';

export interface VoucherDraft {
  version: 1;
  savedAt: number; // Unix timestamp in ms
  businessId: string;
  userId: string;
  voucherType: 'SALES' | 'PURCHASE';
  voucherId: string | null;
  form: VoucherFormState;
}

const DRAFT_PREFIX = 'vpro_erp_draft_';
const MAX_DRAFT_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function getDraftKey(businessId: string, userId: string, voucherType: string, voucherId: string | null): string {
  const safeBiz = (businessId || 'unknown').trim();
  const safeUser = (userId || 'unknown').trim();
  const safeId = (voucherId || 'new').trim();
  return `${DRAFT_PREFIX}${safeBiz}_${safeUser}_${voucherType}_${safeId}`;
}

/**
 * Saves a voucher draft to local storage. Only saves if there is actual entered data.
 */
export function saveVoucherDraft(
  businessId: string,
  userId: string,
  voucherType: 'SALES' | 'PURCHASE',
  voucherId: string | null,
  form: VoucherFormState
): boolean {
  if (typeof window === 'undefined' || !window.localStorage) return false;
  if (!businessId || !userId) return false;

  const normalized = normalizeVoucherSnapshot(form);
  // Do not store if completely empty
  const hasContent =
    normalized.partyId !== '' ||
    normalized.referenceNumber !== '' ||
    normalized.notes !== '' ||
    normalized.courierCharges > 0 ||
    normalized.invoiceDiscount > 0 ||
    normalized.lines.length > 0;

  if (!hasContent) {
    clearVoucherDraft(businessId, userId, voucherType, voucherId);
    return false;
  }

  const draft: VoucherDraft = {
    version: 1,
    savedAt: Date.now(),
    businessId,
    userId,
    voucherType,
    voucherId,
    form,
  };

  try {
    const key = getDraftKey(businessId, userId, voucherType, voucherId);
    localStorage.setItem(key, JSON.stringify(draft));
    return true;
  } catch (err) {
    console.warn('[DRAFT_STORAGE_SAVE_FAILED]', err);
    return false;
  }
}

/**
 * Retrieves a saved voucher draft, strictly verifying authorized business and user context.
 */
export function getVoucherDraft(
  businessId: string,
  userId: string,
  voucherType: 'SALES' | 'PURCHASE',
  voucherId: string | null
): VoucherDraft | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  if (!businessId || !userId) return null;

  try {
    const key = getDraftKey(businessId, userId, voucherType, voucherId);
    const raw = localStorage.getItem(key);
    if (!raw) return null;

    const draft = JSON.parse(raw) as VoucherDraft;

    // Strict validation
    if (
      !draft ||
      draft.version !== 1 ||
      draft.businessId !== businessId ||
      draft.userId !== userId ||
      draft.voucherType !== voucherType ||
      (voucherId ? draft.voucherId !== voucherId : draft.voucherId !== null)
    ) {
      return null;
    }

    // Check expiration (7 days)
    if (Date.now() - draft.savedAt > MAX_DRAFT_AGE_MS) {
      localStorage.removeItem(key);
      return null;
    }

    return draft;
  } catch (err) {
    console.warn('[DRAFT_STORAGE_READ_FAILED]', err);
    return null;
  }
}

/**
 * Removes a saved voucher draft upon successful backend save or user discard.
 */
export function clearVoucherDraft(
  businessId: string,
  userId: string,
  voucherType: 'SALES' | 'PURCHASE',
  voucherId: string | null
): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  if (!businessId || !userId) return;

  try {
    const key = getDraftKey(businessId, userId, voucherType, voucherId);
    localStorage.removeItem(key);
  } catch (err) {
    console.warn('[DRAFT_STORAGE_CLEAR_FAILED]', err);
  }
}

/**
 * Housekeeping: removes expired drafts older than 7 days.
 */
export function pruneExpiredDrafts(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;

  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(DRAFT_PREFIX)) {
        try {
          const item = JSON.parse(localStorage.getItem(key) || '{}');
          if (item && item.savedAt && Date.now() - item.savedAt > MAX_DRAFT_AGE_MS) {
            keysToRemove.push(key);
          }
        } catch {
          keysToRemove.push(key);
        }
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
  } catch (err) {
    console.warn('[DRAFT_STORAGE_PRUNE_FAILED]', err);
  }
}
