/**
 * Indian GST State Code and Place of Supply Helpers
 * Auto-detects INTRA_STATE (CGST + SGST) vs INTER_STATE (IGST) based on Party & Business State/GSTIN
 */

export const GST_STATE_CODE_MAP: Record<string, string> = {
  '01': 'Jammu & Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
  '97': 'Other Territory',
};

export const INDIAN_STATES_LIST: { code: string; name: string }[] = Object.entries(GST_STATE_CODE_MAP)
  .map(([code, name]) => ({ code, name }))
  .sort((a, b) => a.name.localeCompare(b.name));

const ALIASES: Record<string, string> = {
  dl: 'delhi',
  'nct of delhi': 'delhi',
  'new delhi': 'delhi',
  mh: 'maharashtra',
  maha: 'maharashtra',
  ka: 'karnataka',
  kar: 'karnataka',
  tn: 'tamil nadu',
  tamilnadu: 'tamil nadu',
  up: 'uttar pradesh',
  hr: 'haryana',
  rj: 'rajasthan',
  raj: 'rajasthan',
  gj: 'gujarat',
  guj: 'gujarat',
  wb: 'west bengal',
  br: 'bihar',
  pb: 'punjab',
  ch: 'chandigarh',
  ts: 'telangana',
  tg: 'telangana',
  ap: 'andhra pradesh',
  kl: 'kerala',
  ker: 'kerala',
  mp: 'madhya pradesh',
  or: 'odisha',
  orissa: 'odisha',
  cg: 'chhattisgarh',
  jh: 'jharkhand',
  as: 'assam',
  uk: 'uttarakhand',
  ua: 'uttarakhand',
  uttaranchal: 'uttarakhand',
  hp: 'himachal pradesh',
  jk: 'jammu & kashmir',
  'jammu and kashmir': 'jammu & kashmir',
  ga: 'goa',
  py: 'puducherry',
  pondicherry: 'puducherry',
  la: 'ladakh',
};

/**
 * Normalizes state names for accurate comparison
 */
export function normalizeState(state?: string | null): string {
  if (!state) return '';
  const trimmed = state.trim();
  
  // If it's a 2-digit code
  if (/^\d{2}$/.test(trimmed) && GST_STATE_CODE_MAP[trimmed]) {
    return GST_STATE_CODE_MAP[trimmed].toLowerCase();
  }

  // If it has code prefix like "27 - Maharashtra" or "27-Maharashtra"
  const prefixMatch = trimmed.match(/^(\d{2})\s*[-:]\s*(.+)$/);
  if (prefixMatch && GST_STATE_CODE_MAP[prefixMatch[1]]) {
    return GST_STATE_CODE_MAP[prefixMatch[1]].toLowerCase();
  }

  const clean = trimmed.toLowerCase().replace(/[^\w\s&]/g, '').replace(/\s+/g, ' ');
  return ALIASES[clean] || clean;
}

/**
 * Gets capitalized display title for state
 */
export function getDisplayStateName(state?: string | null): string {
  if (!state) return '';
  const normalized = normalizeState(state);
  const found = INDIAN_STATES_LIST.find(s => s.name.toLowerCase() === normalized);
  if (found) return found.name;
  return state.trim();
}

/**
 * Extracts state from GSTIN using the first 2 characters
 */
export function getStateFromGstin(gstin?: string | null): string | null {
  if (!gstin || typeof gstin !== 'string') return null;
  const trimmed = gstin.trim().toUpperCase();
  if (trimmed.length < 2) return null;
  const code = trimmed.substring(0, 2);
  const matched = GST_STATE_CODE_MAP[code];
  return matched || null;
}

/**
 * Resolves entity state from its state, placeOfSupply, GSTIN or stateCode
 */
export function resolveEntityState(entity?: {
  state?: string | null;
  placeOfSupply?: string | null;
  gstin?: string | null;
  stateCode?: string | null;
} | null): string {
  if (!entity) return '';

  if (entity.state && entity.state.trim().length > 0) {
    return normalizeState(entity.state);
  }

  if (entity.placeOfSupply && entity.placeOfSupply.trim().length > 0) {
    return normalizeState(entity.placeOfSupply);
  }

  if (entity.gstin) {
    const fromGst = getStateFromGstin(entity.gstin);
    if (fromGst) return normalizeState(fromGst);
  }

  if (entity.stateCode && GST_STATE_CODE_MAP[entity.stateCode.trim()]) {
    return normalizeState(GST_STATE_CODE_MAP[entity.stateCode.trim()]);
  }

  return '';
}

/**
 * Automatically determines GST Mode based on Business and Party state
 * - Returns 'INTER_STATE' if states are different (IGST applies)
 * - Returns 'INTRA_STATE' if states are the same (CGST + SGST apply)
 */
export function determineGstMode(
  business?: { state?: string | null; stateCode?: string | null; gstin?: string | null } | null,
  party?: { state?: string | null; placeOfSupply?: string | null; gstin?: string | null; stateCode?: string | null } | null,
  fallbackBusinessState: string = 'maharashtra'
): 'INTRA_STATE' | 'INTER_STATE' {
  let bizState = resolveEntityState(business);
  if (!bizState && fallbackBusinessState) {
    bizState = normalizeState(fallbackBusinessState);
  }

  const partyState = resolveEntityState(party);

  if (!partyState) {
    // If party state is unknown, check GSTINs directly
    if (business?.gstin && party?.gstin) {
      const bizCode = business.gstin.trim().substring(0, 2);
      const partyCode = party.gstin.trim().substring(0, 2);
      if (bizCode.length === 2 && partyCode.length === 2) {
        return bizCode !== partyCode ? 'INTER_STATE' : 'INTRA_STATE';
      }
    }
    // Default to intra-state when unknown
    return 'INTRA_STATE';
  }

  if (!bizState) {
    return 'INTRA_STATE';
  }

  return bizState !== partyState ? 'INTER_STATE' : 'INTRA_STATE';
}

/**
 * Formats GST mode for clear user-facing labels
 */
export function formatGstModeBadge(mode: 'INTRA_STATE' | 'INTER_STATE' | 'EXEMPT'): {
  label: string;
  shortLabel: string;
  type: 'IGST' | 'CGST+SGST' | 'EXEMPT';
} {
  if (mode === 'INTER_STATE') {
    return {
      label: 'INTERSTATE (IGST)',
      shortLabel: 'IGST',
      type: 'IGST',
    };
  }
  if (mode === 'EXEMPT') {
    return {
      label: 'EXEMPT',
      shortLabel: 'Exempt',
      type: 'EXEMPT',
    };
  }
  return {
    label: 'INTRA-STATE (CGST + SGST)',
    shortLabel: 'CGST+SGST',
    type: 'CGST+SGST',
  };
}
