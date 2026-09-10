/**
 * Utility to convert numeric amounts into Indian Currency Words
 * Example: 15420.50 => "Rupees Fifteen Thousand Four Hundred Twenty and Fifty Paise Only"
 */

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen'
];

const TENS = [
  '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'
];

function convertBelowThousand(n: number): string {
  if (n === 0) return '';
  if (n < 20) return ONES[n];
  if (n < 100) {
    const rem = n % 10;
    return `${TENS[Math.floor(n / 10)]}${rem ? ' ' + ONES[rem] : ''}`;
  }
  const hundreds = Math.floor(n / 100);
  const rem = n % 100;
  return `${ONES[hundreds]} Hundred${rem ? ' ' + convertBelowThousand(rem) : ''}`;
}

export function numberToIndianWords(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined || isNaN(Number(amount))) {
    return 'Rupees Zero Only';
  }

  const num = Math.abs(Number(amount));
  if (num === 0) return 'Rupees Zero Only';

  const [rupeesPart, paisePart] = num.toFixed(2).split('.');
  let rupees = parseInt(rupeesPart, 10);
  const paise = parseInt(paisePart, 10);

  const parts: string[] = [];

  // Crores (10,000,000)
  if (rupees >= 10000000) {
    const crores = Math.floor(rupees / 10000000);
    parts.push(`${convertBelowThousand(crores)} Crore`);
    rupees %= 10000000;
  }

  // Lakhs (100,000)
  if (rupees >= 100000) {
    const lakhs = Math.floor(rupees / 100000);
    parts.push(`${convertBelowThousand(lakhs)} Lakh`);
    rupees %= 100000;
  }

  // Thousands (1,000)
  if (rupees >= 1000) {
    const thousands = Math.floor(rupees / 1000);
    parts.push(`${convertBelowThousand(thousands)} Thousand`);
    rupees %= 1000;
  }

  // Hundreds and remainder
  if (rupees > 0) {
    parts.push(convertBelowThousand(rupees));
  }

  let words = parts.filter(Boolean).join(' ').trim();
  if (!words) words = 'Zero';

  const prefix = Number(amount) < 0 ? 'Minus Rupees ' : 'Rupees ';
  let result = `${prefix}${words}`;

  if (paise > 0) {
    result += ` and ${convertBelowThousand(paise)} Paise`;
  }

  return `${result} Only`;
}
