/**
 * Quick date period utilities for optical ERP reports and ledger views.
 * Standard Indian Financial Year starts April 1st and ends March 31st.
 */

export type QuickPeriodKey = 'THIS_MONTH' | 'LAST_MONTH' | 'THIS_FY' | 'CUSTOM' | 'ALL';

export interface DatePeriodRange {
  from?: string; // YYYY-MM-DD
  to?: string;   // YYYY-MM-DD
}

export function getDateRangeForPeriod(period: QuickPeriodKey): DatePeriodRange {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed (0 = Jan, 3 = Apr, 11 = Dec)

  const pad = (n: number) => String(n).padStart(2, '0');

  switch (period) {
    case 'THIS_MONTH': {
      const from = `${year}-${pad(month + 1)}-01`;
      const lastDay = new Date(year, month + 1, 0).getDate();
      const to = `${year}-${pad(month + 1)}-${pad(lastDay)}`;
      return { from, to };
    }
    case 'LAST_MONTH': {
      const prevMonthYear = month === 0 ? year - 1 : year;
      const prevMonth = month === 0 ? 11 : month - 1;
      const from = `${prevMonthYear}-${pad(prevMonth + 1)}-01`;
      const lastDay = new Date(prevMonthYear, prevMonth + 1, 0).getDate();
      const to = `${prevMonthYear}-${pad(prevMonth + 1)}-${pad(lastDay)}`;
      return { from, to };
    }
    case 'THIS_FY': {
      // Indian Financial Year: April 1 to March 31
      let fyStartYear: number;
      let fyEndYear: number;

      if (month >= 3) {
        // Current month is April or later
        fyStartYear = year;
        fyEndYear = year + 1;
      } else {
        // Current month is Jan, Feb, or Mar
        fyStartYear = year - 1;
        fyEndYear = year;
      }
      return {
        from: `${fyStartYear}-04-01`,
        to: `${fyEndYear}-03-31`,
      };
    }
    case 'ALL':
    case 'CUSTOM':
    default:
      return {};
  }
}
