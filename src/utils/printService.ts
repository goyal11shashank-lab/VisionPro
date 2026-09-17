/**
 * Robust Web Printing Service
 * Handles direct native printing via window.print(), ensuring the OS/Browser
 * system print dialog (Chrome, Safari, Edge, macOS, Windows, Linux) is invoked.
 *
 * Utilizes a dedicated #print-root DOM node and @media print CSS rules for document
 * isolation (hiding web chrome, sidebars, navigation, modals, and toolbars, and
 * printing exclusively the dedicated document).
 */

export interface PrintOptions {
  elementOrId: HTMLElement | string;
  title?: string;
  filename?: string;
  orientation?: 'portrait' | 'landscape';
}

export interface PrintResult {
  success: boolean;
  method: 'native_print' | 'restricted' | 'error';
  message?: string;
}

/**
 * Checks if the current window is running inside an iframe.
 */
export function isRunningInIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

/**
 * Initiates native print workflow for an element or element ID.
 * Invokes browser/system print dialog directly via window.print().
 */
export async function printDocument(options: PrintOptions): Promise<PrintResult> {
  const {
    elementOrId,
    title,
    orientation = 'portrait',
  } = options;

  // Feature detection (Requirement #33)
  if (typeof window === 'undefined' || typeof window.print !== 'function') {
    throw new Error('Browser native printing is not supported in this environment.');
  }

  const targetEl = typeof elementOrId === 'string'
    ? document.getElementById(elementOrId)
    : elementOrId;

  if (!targetEl) {
    console.error('[PrintService] Target element not found:', elementOrId);
    throw new Error('Unable to prepare this document for printing.');
  }

  // Ensure #print-root exists in document body
  let printRoot = document.getElementById('print-root');
  if (!printRoot) {
    printRoot = document.createElement('div');
    printRoot.id = 'print-root';
    document.body.appendChild(printRoot);
  }

  // Populate #print-root with a clean clone of the printable content
  printRoot.innerHTML = '';
  const clone = targetEl.cloneNode(true) as HTMLElement;
  clone.classList.add('print-document-container');
  printRoot.appendChild(clone);

  // Mark body as currently printing
  document.body.classList.add('is-printing');

  // Set document title temporarily so Chrome/Safari defaults the PDF/printed document title
  const originalTitle = document.title;
  if (title) {
    document.title = title;
  }

  // Configure print orientation on body
  if (orientation === 'landscape') {
    document.body.classList.add('print-landscape');
  } else {
    document.body.classList.remove('print-landscape');
  }

  // Cleanup handler
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    document.title = originalTitle;
    document.body.classList.remove('print-landscape');
    document.body.classList.remove('is-printing');
    if (printRoot) {
      printRoot.innerHTML = '';
    }
    window.removeEventListener('afterprint', cleanup);
  };

  window.addEventListener('afterprint', cleanup, { once: true });
  // Safety fallback cleanup in case afterprint does not fire in certain browser versions
  setTimeout(cleanup, 2000);

  try {
    window.focus();

    // Call native window.print() directly within the user gesture execution context
    window.print();

    return {
      success: true,
      method: 'native_print',
    };
  } catch (err: any) {
    console.warn('[PrintService] Direct window.print() failed:', err);

    // Detect iframe sandbox modal restrictions (e.g. AI Studio embedded preview without allow-modals)
    const errString = String(err?.message || err || '');
    const isSandboxRestricted =
      err?.name === 'SecurityError' ||
      errString.includes('sandbox') ||
      errString.includes('modal dialog') ||
      errString.includes('not permitted');

    if (isSandboxRestricted || isRunningInIframe()) {
      return {
        success: false,
        method: 'restricted',
        message: 'Printing is restricted in the embedded preview. Open the app preview in a browser tab and print again.',
      };
    }

    throw new Error(err?.message || 'Unable to prepare this document for printing.');
  }
}


