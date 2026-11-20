/**
 * Global row-actions adapter.
 *
 * Two behaviours, applied app-wide without touching individual pages:
 *
 * 1. Row actions menu. In every data table the "Actions" column is collapsed:
 *    the header text is removed and each actionable row keeps its original
 *    controls inside a visually-hidden wrapper (still in the DOM, so React
 *    handlers, disabled states and confirmation dialogs are untouched), plus
 *    one injected, focusable "..." trigger button. The trigger opens the row's
 *    action menu on click/tap (touch), via keyboard (Tab + Enter/Space), and
 *    right-clicking anywhere on the row opens the same menu (desktop intent).
 *    Menu items proxy a single real .click() to the original control, so every
 *    existing handler, permission check and confirmation dialog keeps working
 *    unchanged. When the Settings toggle is off, nothing is collapsed and the
 *    full original Actions column is shown.
 *
 *    Accessibility: the hidden wrapper is aria-hidden and every original
 *    control inside it gets tabindex=-1 while collapsed, so assistive tech and
 *    tab navigation see only the single injected trigger (no duplication).
 *    The injected trigger carries aria-label="Row actions", aria-haspopup and
 *    aria-expanded. The menu is keyboard navigable (arrows/Home/End/Enter,
 *    Escape returns focus to the trigger).
 *
 * 2. On the Stock Items master routes, hides the owner-requested columns
 *    (SKU Code, Primary Item, Category, GST Rate). Display-only: underlying
 *    data and exports are untouched.
 *
 * Scoping rules keep nested tables and mixed headers safe: the Actions column
 * index is resolved per table from that table's own thead (exact "actions"
 * match), and only the table's own tbody rows are processed, so a table nested
 * inside a cell is handled as its own table and never via the outer row.
 *
 * A MutationObserver re-applies the marking because React re-renders tables on
 * every data change, and un-marks everything when the toggle is turned off.
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
const ORIGINAL_TEXT_ATTR = 'data-gra-original-text';
const SR_CLASS = 'ga-sr';
const TRIGGER_CLASS = 'ga-trigger';
const STYLE_ID = 'gra-styles';
const MENU_ID = 'gra-context-menu';

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    [${HIDDEN_ATTR}="1"] { display: none !important; }
    th.${SR_CLASS}-head, td.${SR_CLASS}-cell { width: 44px !important; min-width: 44px !important; max-width: 44px !important; }
    .${SR_CLASS} {
      position: absolute !important; width: 1px !important; height: 1px !important;
      padding: 0 !important; margin: -1px !important; overflow: hidden !important;
      clip: rect(0 0 0 0) !important; clip-path: inset(50%) !important;
      white-space: nowrap !important; border: 0 !important;
    }
    .${TRIGGER_CLASS} {
      display: inline-flex; align-items: center; justify-content: center;
      width: 30px; height: 30px; border-radius: 7px; border: 1px solid transparent;
      background: transparent; color: #64748b; cursor: pointer;
      font-size: 17px; line-height: 1; font-weight: 700; padding: 0 0 6px;
    }
    .${TRIGGER_CLASS}:hover { background: #f1f5f9; color: #0f172a; border-color: #e2e8f0; }
    .${TRIGGER_CLASS}:focus-visible { outline: 2px solid #4f46e5; outline-offset: 1px; }
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
    #${MENU_ID} .gra-item:hover, #${MENU_ID} .gra-item:focus-visible { background: #f1f5f9; outline: none; }
    #${MENU_ID} .gra-item.gra-danger { color: #b91c1c; }
  `;
  document.head.appendChild(style);
}

function headerText(cell: Element): string {
  return (cell.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** The table's own header cells (never a nested table's). */
function ownHeaderCells(table: HTMLTableElement): Element[] {
  const thead = table.tHead;
  if (!thead || thead.rows.length === 0) return [];
  return Array.from(thead.rows[0].cells);
}

/** The table's own body rows (never rows of a table nested inside a cell). */
function ownBodyRows(table: HTMLTableElement): HTMLTableRowElement[] {
  const rows: HTMLTableRowElement[] = [];
  Array.from(table.tBodies).forEach((tbody) => {
    Array.from(tbody.rows).forEach((row) => rows.push(row));
  });
  return rows;
}

function headerIndex(table: HTMLTableElement, headerCell: Element): number {
  return ownHeaderCells(table).indexOf(headerCell);
}

// ---------- collapse / restore ----------

function unwrapCell(cell: Element): void {
  const wrapper = cell.querySelector(`span.${SR_CLASS}`);
  if (wrapper) {
    wrapper.querySelectorAll('[data-gra-tabindex]').forEach((el) => {
      el.removeAttribute('tabindex');
      el.removeAttribute('data-gra-tabindex');
    });
    while (wrapper.firstChild) cell.insertBefore(wrapper.firstChild, wrapper);
    wrapper.remove();
  }
  cell.querySelectorAll(`button.${TRIGGER_CLASS}`).forEach((el) => el.remove());
  cell.classList.remove(`${SR_CLASS}-cell`);
  cell.removeAttribute(ACTIONS_CELL_ATTR);
}

function unmark(table: HTMLTableElement): void {
  table.querySelectorAll(`[${HIDDEN_ATTR}]`).forEach((el) => {
    el.removeAttribute(HIDDEN_ATTR);
  });
  ownHeaderCells(table).forEach((th) => {
    if (th.hasAttribute(ORIGINAL_TEXT_ATTR)) {
      th.textContent = th.getAttribute(ORIGINAL_TEXT_ATTR);
      th.removeAttribute(ORIGINAL_TEXT_ATTR);
    }
    th.classList.remove(`${SR_CLASS}-head`);
  });
  ownBodyRows(table).forEach((row) => {
    Array.from(row.children).forEach((cell) => {
      if (cell.hasAttribute(ACTIONS_CELL_ATTR) || cell.querySelector(`button.${TRIGGER_CLASS}`)) {
        unwrapCell(cell);
      }
    });
  });
}

function collapseActionsColumn(table: HTMLTableElement, headerCell: Element): void {
  const index = headerIndex(table, headerCell);
  if (index < 0) return;
  if (!headerCell.hasAttribute(ORIGINAL_TEXT_ATTR)) {
    headerCell.setAttribute(ORIGINAL_TEXT_ATTR, headerCell.textContent || '');
  }
  headerCell.textContent = '';
  headerCell.classList.add(`${SR_CLASS}-head`);
  headerCell.setAttribute('aria-hidden', 'true');

  ownBodyRows(table).forEach((row) => {
    const cell = row.children[index];
    if (!(cell instanceof HTMLElement)) return;
    if (cell.querySelector(`button.${TRIGGER_CLASS}`)) return; // already collapsed
    const controls = Array.from(cell.querySelectorAll('button, a, [role="button"]'));
    if (controls.length === 0) return;

    const wrapper = document.createElement('span');
    wrapper.className = SR_CLASS;
    wrapper.setAttribute('aria-hidden', 'true');
    while (cell.firstChild) wrapper.appendChild(cell.firstChild);
    // Keep originals clickable for proxying but out of tab order / AT while hidden.
    wrapper.querySelectorAll('button, a, [role="button"]').forEach((el) => {
      if (!el.hasAttribute('data-gra-tabindex')) {
        el.setAttribute('data-gra-tabindex', '1');
        el.setAttribute('tabindex', '-1');
      }
    });
    cell.appendChild(wrapper);

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = TRIGGER_CLASS;
    trigger.textContent = '...';
    trigger.setAttribute('aria-label', 'Row actions');
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.title = 'Row actions (or right-click the row)';
    trigger.addEventListener('click', (event) => {
      event.stopPropagation();
      event.preventDefault();
      openMenuForRow(row, trigger);
    });
    trigger.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        openMenuForRow(row, trigger);
      }
    });
    cell.appendChild(trigger);

    cell.classList.add(`${SR_CLASS}-cell`);
    cell.setAttribute(ACTIONS_CELL_ATTR, '1');
  });
}

function hideColumn(table: HTMLTableElement, headerCell: Element): void {
  const index = headerIndex(table, headerCell);
  if (index < 0) return;
  headerCell.setAttribute(HIDDEN_ATTR, '1');
  ownBodyRows(table).forEach((row) => {
    const cell = row.children[index];
    if (cell) cell.setAttribute(HIDDEN_ATTR, '1');
  });
}

function applyTableRules(): void {
  const toggles = uiToggles();
  const onStockItems = toggles.hideStockItemMasterColumns && STOCK_ITEM_ROUTES.has(window.location.pathname);
  document.querySelectorAll('table').forEach((table) => {
    if (!(table instanceof HTMLTableElement)) return;
    unmark(table);
    ownHeaderCells(table).forEach((th) => {
      const text = headerText(th);
      if (text === ACTIONS_HEADER && toggles.rightClickRowActions) {
        collapseActionsColumn(table, th);
      } else if (onStockItems && STOCK_ITEM_HIDDEN_HEADERS.has(text)) {
        hideColumn(table, th);
      }
    });
  });
}

// ---------- menu ----------

interface MenuAction {
  label: string;
  danger: boolean;
  el: HTMLElement;
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
  // Only this row's own actions cell (never a nested table's cell).
  const cell = Array.from(row.children).find((c) => c.hasAttribute(ACTIONS_CELL_ATTR));
  if (!cell) return [];
  const controls = Array.from(cell.querySelectorAll('button, a, [role="button"]')).filter((el) => {
    if (el.classList.contains(TRIGGER_CLASS)) return false; // our own trigger
    if (el instanceof HTMLButtonElement && el.disabled) return false;
    if (el.getAttribute('aria-disabled') === 'true') return false;
    return el instanceof HTMLElement;
  });
  return controls.map((el, i) => {
    const label = actionLabel(el, `Action ${i + 1}`);
    return {
      label,
      danger: /delete|remove|cancel/i.test(label),
      el: el as HTMLElement,
    };
  });
}

let menuEl: HTMLDivElement | null = null;
let menuInvoker: HTMLElement | null = null;

function closeMenu(restoreFocus = false): void {
  if (menuEl) {
    menuEl.remove();
    menuEl = null;
  }
  if (menuInvoker) {
    menuInvoker.setAttribute('aria-expanded', 'false');
    if (restoreFocus) menuInvoker.focus();
    menuInvoker = null;
  }
}

function menuItems(): HTMLButtonElement[] {
  if (!menuEl) return [];
  return Array.from(menuEl.querySelectorAll('button.gra-item'));
}

function focusItem(offset: number): void {
  const items = menuItems();
  if (items.length === 0) return;
  const active = document.activeElement;
  const current = items.findIndex((el) => el === active);
  const next = current < 0 ? (offset > 0 ? 0 : items.length - 1) : (current + offset + items.length) % items.length;
  items[next].focus();
}

function onMenuKeydown(event: KeyboardEvent): void {
  if (!menuEl) return;
  switch (event.key) {
    case 'Escape':
      event.preventDefault();
      closeMenu(true);
      break;
    case 'ArrowDown':
      event.preventDefault();
      focusItem(1);
      break;
    case 'ArrowUp':
      event.preventDefault();
      focusItem(-1);
      break;
    case 'Home':
      event.preventDefault();
      menuItems()[0]?.focus();
      break;
    case 'End':
      event.preventDefault();
      menuItems().slice(-1)[0]?.focus();
      break;
    case 'Tab':
      closeMenu();
      break;
    default:
      break;
  }
}

function openMenu(actions: MenuAction[], x: number, y: number, invoker: HTMLElement | null): void {
  closeMenu();
  const menu = document.createElement('div');
  menu.id = MENU_ID;
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Row actions');
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
      action.el.click(); // single proxied click: original handler + confirmations run once
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
  menuInvoker = invoker;
  if (invoker) invoker.setAttribute('aria-expanded', 'true');
  menuItems()[0]?.focus();
}

function openMenuForRow(row: HTMLTableRowElement, invoker: HTMLElement | null, x?: number, y?: number): void {
  if (!uiToggles().rightClickRowActions) return;
  const actions = collectRowActions(row);
  if (actions.length === 0) return;
  let px = x;
  let py = y;
  if ((px === undefined || py === undefined) && invoker) {
    const rect = invoker.getBoundingClientRect();
    px = rect.left;
    py = rect.bottom + 4;
  }
  openMenu(actions, px ?? 40, py ?? 40, invoker);
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
  const trigger = row.querySelector(`button.${TRIGGER_CLASS}`) as HTMLElement | null;
  const actions = collectRowActions(row);
  if (actions.length === 0) return; // no row actions: keep the native browser menu
  event.preventDefault();
  event.stopPropagation();
  openMenu(actions, event.clientX, event.clientY, trigger);
}

// ---------- wiring ----------

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
  document.addEventListener('click', (event) => {
    const target = event.target as Element | null;
    if (menuEl && target && !(target.closest && target.closest(`#${MENU_ID}`))) closeMenu();
    else if (menuEl) closeMenu();
  }, true);
  document.addEventListener('keydown', onMenuKeydown);
  window.addEventListener('scroll', closeMenu as () => void, true);
  window.addEventListener('resize', () => closeMenu());
}
