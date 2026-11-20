/**
 * Global row-actions adapter.
 *
 * Two behaviours, applied app-wide without touching individual pages:
 * 1. Hides the "Actions" column in every data table and instead shows the row's
 *    action buttons as a right-click (context) menu on the row. The original
 *    buttons stay in the DOM (display:none) and menu items proxy a real click to
 *    them, so every existing handler, permission check and confirmation dialog
 *    keeps working unchanged.
 * 2. On the Stock Items master routes, hides the owner-requested columns
 *    (SKU Code, Primary Item, Category, GST Rate). Display-only: underlying
 *    data and exports are untouched.
 *
 * A MutationObserver re-applies the marking because React re-renders tables on
 * every data change.
 */

const ACTIONS_HEADER = 'actions';

interface UiToggles {
  rightClickRowActions: boolean;
  hideStockItemMasterColumns: boolean;
}

function uiToggles(): UiToggles {
  const w = window as unknown as { __erpUiSettings?: Partial<UiToggles> };
  return {
    rightClickRowActions: w.__erpUiSettings?.rightClickRowActions ?? true,
    hideStockItemMasterColumns: w.__erpUiSettings?.hideStockItemMasterColumns ?? true,
  };
}


const STOCK_ITEM_ROUTES = new Set([
  '/master/primary-items',
  '/master/stock-items',
  '/stock-items',
  '/master/unique-items',
  '/unique-items',
]);

const STOCK_ITEM_HIDDEN_HEADERS = new Set([
  'sku code',
  'primary item',
  'category',
  'gst rate',
]);

const HIDDEN_ATTR = 'data-gra-hidden';
const ACTIONS_CELL_ATTR = 'data-gra-actions-cell';
const STYLE_ID = 'gra-styles';
const MENU_ID = 'gra-context-menu';

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    [${HIDDEN_ATTR}="1"] { display: none !important; }
    #${MENU_ID} {
      position: fixed; z-index: 99999; min-width: 200px; max-width: 340px;
      background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px;
      box-shadow: 0 12px 32px rgba(15, 23, 42, 0.18);
      padding: 4px; font-family: inherit;
    }
    #${MENU_ID} .gra-item {
      display: block; width: 100%; text-align: left; border: 0; background: transparent;
      padding: 8px 12px; border-radius: 7px; cursor: pointer;
      font-size: 13px; font-weight: 500; color: #1e293b;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    #${MENU_ID} .gra-item:hover { background: #f1f5f9; }
    #${MENU_ID} .gra-item.gra-danger { color: #b91c1c; }
  `;
  document.head.appendChild(style);
}

function headerText(cell: Element): string {
  return (cell.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function unmark(table: HTMLTableElement): void {
  table.querySelectorAll(`[${HIDDEN_ATTR}]`).forEach((el) => {
    el.removeAttribute(HIDDEN_ATTR);
  });
  table.querySelectorAll(`[${ACTIONS_CELL_ATTR}]`).forEach((el) => {
    el.removeAttribute(ACTIONS_CELL_ATTR);
  });
}

function hideColumn(table: HTMLTableElement, headerCell: Element): void {
  const headerRow = headerCell.parentElement;
  if (!headerRow) return;
  const index = Array.from(headerRow.children).indexOf(headerCell);
  if (index < 0) return;
  headerCell.setAttribute(HIDDEN_ATTR, '1');
  table.querySelectorAll('tbody tr').forEach((row) => {
    const cell = row.children[index];
    if (cell) cell.setAttribute(HIDDEN_ATTR, '1');
  });
}

function markActionsCell(table: HTMLTableElement, headerCell: Element): void {
  const headerRow = headerCell.parentElement;
  if (!headerRow) return;
  const index = Array.from(headerRow.children).indexOf(headerCell);
  if (index < 0) return;
  table.querySelectorAll('tbody tr').forEach((row) => {
    const cell = row.children[index];
    if (cell && cell.querySelector('button, a')) {
      cell.setAttribute(ACTIONS_CELL_ATTR, '1');
    }
  });
}

function applyTableRules(): void {
  const toggles = uiToggles();
  const onStockItems = toggles.hideStockItemMasterColumns && STOCK_ITEM_ROUTES.has(window.location.pathname);
  document.querySelectorAll('table').forEach((table) => {
    if (!(table instanceof HTMLTableElement)) return;
    unmark(table);
    const headerCells = table.querySelectorAll('thead th');
    headerCells.forEach((th) => {
      const text = headerText(th);
      if (text === ACTIONS_HEADER && toggles.rightClickRowActions) {
        markActionsCell(table, th);
        hideColumn(table, th);
      } else if (onStockItems && STOCK_ITEM_HIDDEN_HEADERS.has(text)) {
        hideColumn(table, th);
      }
    });
  });
}

interface MenuAction {
  label: string;
  danger: boolean;
  trigger: () => void;
}

function actionLabel(el: Element, fallback: string): string {
  const raw =
    el.getAttribute('title') ||
    el.getAttribute('aria-label') ||
    (el.textContent || '').replace(/\s+/g, ' ').trim() ||
    fallback;
  return raw.length > 60 ? `${raw.slice(0, 57)}...` : raw;
}

function collectRowActions(row: HTMLTableRowElement): MenuAction[] {
  const cell = row.querySelector(`[${ACTIONS_CELL_ATTR}="1"]`);
  if (!cell) return [];
  const controls = Array.from(cell.querySelectorAll('button, a')).filter((el) => {
    if (el instanceof HTMLButtonElement && el.disabled) return false;
    if (el.getAttribute('aria-disabled') === 'true') return false;
    return true;
  });
  return controls.map((el, i) => {
    const label = actionLabel(el, `Action ${i + 1}`);
    return {
      label,
      danger: /delete|remove|cancel/i.test(label),
      trigger: () => {
        if (el instanceof HTMLElement) el.click();
      },
    };
  });
}

let menuEl: HTMLDivElement | null = null;

function closeMenu(): void {
  if (menuEl) {
    menuEl.remove();
    menuEl = null;
  }
}

function openMenu(actions: MenuAction[], x: number, y: number): void {
  closeMenu();
  const menu = document.createElement('div');
  menu.id = MENU_ID;
  menu.setAttribute('role', 'menu');
  actions.forEach((action) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `gra-item${action.danger ? ' gra-danger' : ''}`;
    item.textContent = action.label;
    item.title = action.label;
    item.setAttribute('role', 'menuitem');
    item.addEventListener('click', (event) => {
      event.stopPropagation();
      closeMenu();
      action.trigger();
    });
    menu.appendChild(item);
  });
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - rect.width - 8);
  const top = Math.min(y, window.innerHeight - rect.height - 8);
  menu.style.left = `${Math.max(4, left)}px`;
  menu.style.top = `${Math.max(4, top)}px`;
  menuEl = menu;
}

function onContextMenu(event: MouseEvent): void {
  const target = event.target as Element | null;
  if (!target || typeof target.closest !== 'function') return;
  if (target.closest(`#${MENU_ID}`)) return;
  const row = target.closest('tr');
  if (!(row instanceof HTMLTableRowElement)) {
    closeMenu();
    return;
  }
  if (!uiToggles().rightClickRowActions) return; // feature toggled off in Settings
  const actions = collectRowActions(row);
  if (actions.length === 0) return; // no row actions: keep the native browser menu
  event.preventDefault();
  event.stopPropagation();
  openMenu(actions, event.clientX, event.clientY);
}

let observer: MutationObserver | null = null;
let scheduled = false;

function scheduleApply(): void {
  if (scheduled) return;
  scheduled = true;
  window.setTimeout(() => {
    scheduled = false;
    applyTableRules();
  }, 50);
}

export function initGlobalRowActions(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const w = window as unknown as { __graInit?: boolean };
  if (w.__graInit) return;
  w.__graInit = true;

  injectStyles();
  applyTableRules();

  observer = new MutationObserver(scheduleApply);
  observer.observe(document.body, { childList: true, subtree: true });

  document.addEventListener('contextmenu', onContextMenu, true);
  document.addEventListener('click', closeMenu, true);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenu();
  });
  window.addEventListener('scroll', closeMenu, true);
  window.addEventListener('resize', closeMenu);
}
