/**
 * Robust Web Printing Service
 * Handles direct native printing via window.print(), ensuring the OS/Browser
 * system print dialog (Chrome, Safari, Edge, macOS) is invoked.
 *
 * Utilizes @media print CSS rules for document isolation (hiding web chrome,
 * sidebars, navigation, modals, and toolbars, and printing only the dedicated
 * invoice document).
 */

import { exportToPdf } from './pdfExporter.js';

export interface PrintOptions {
  elementOrId: HTMLElement | string;
  title?: string;
  filename?: string;
  orientation?: 'portrait' | 'landscape';
}

export interface PrintResult {
  success: boolean;
  method: 'native_print' | 'pdf_download' | 'new_tab';
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
    filename = 'invoice',
    orientation = 'portrait',
  } = options;

  const targetEl = typeof elementOrId === 'string'
    ? document.getElementById(elementOrId)
    : elementOrId;

  if (!targetEl) {
    throw new Error(`Print target element "${String(elementOrId)}" not found in DOM.`);
  }

  // Set document title temporarily so Chrome/Safari defaults the PDF filename to this title
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

  try {
    // Ensure styles and DOM are fully settled before invoking print
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        setTimeout(resolve, 50);
      });
    });

    window.focus();

    // Call native window.print() directly
    window.print();

    return {
      success: true,
      method: 'native_print',
    };
  } catch (err: any) {
    console.warn('[PrintService] Direct window.print() failed:', err);

    // If window.print was blocked by an iframe sandbox without allow-modals,
    // gracefully fall back to downloading high-resolution PDF for the user
    try {
      await exportToPdf({
        elementOrId: targetEl,
        filename,
        orientation,
      });

      return {
        success: true,
        method: 'pdf_download',
        message: 'Direct print was restricted by the browser preview sandbox. High-resolution PDF has been downloaded.',
      };
    } catch (pdfErr: any) {
      console.error('[PrintService] PDF fallback failed:', pdfErr);
      throw new Error(
        `Print dialog could not be opened: ${err?.message || 'Blocked by browser'}. PDF generation also failed: ${pdfErr?.message || 'Unknown error'}`
      );
    }
  } finally {
    // Restore document title and orientation class
    setTimeout(() => {
      document.title = originalTitle;
      document.body.classList.remove('print-landscape');
    }, 500);
  }
}

