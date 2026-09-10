/**
 * PDF Exporter using jsPDF and html2canvas-pro.
 * Supports A4 portrait and landscape multi-page document pagination, high DPI, and modern CSS color models including OKLCH.
 */
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas-pro';

export interface ExportPdfOptions {
  elementOrId: HTMLElement | string;
  filename: string;
  orientation?: 'portrait' | 'landscape';
}

export async function exportToPdf(options: ExportPdfOptions): Promise<void> {
  const { elementOrId, filename, orientation = 'portrait' } = options;

  const targetEl = typeof elementOrId === 'string'
    ? document.getElementById(elementOrId)
    : elementOrId;

  if (!targetEl) {
    throw new Error('Printable document element not found for PDF export.');
  }

  // Create high-resolution canvas snapshot of the printable document
  // html2canvas-pro natively supports OKLCH, OKLAB, LAB, LCH and modern CSS color spaces used by Tailwind CSS v4
  const canvas = await html2canvas(targetEl, {
    scale: 2, // High resolution for crisp text and borders
    useCORS: true,
    logging: false,
    backgroundColor: '#ffffff',
    windowWidth: targetEl.scrollWidth,
    onclone: (_clonedDoc, clonedElement) => {
      // Ensure any CSS transform (e.g. preview zoom) does not affect the exported capture
      clonedElement.style.transform = 'none';
      clonedElement.style.margin = '0';
      if (clonedElement.parentElement) {
        clonedElement.parentElement.style.transform = 'none';
      }
    },
  });

  const isPortrait = orientation === 'portrait';
  const pdf = new jsPDF({
    orientation: isPortrait ? 'p' : 'l',
    unit: 'mm',
    format: 'a4',
  });

  // A4 dimensions in mm
  const pageWidth = isPortrait ? 210 : 297;
  const pageHeight = isPortrait ? 297 : 210;

  // Calculate scaled height
  const imgWidth = pageWidth;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  let heightLeft = imgHeight;
  let position = 0;

  // First page
  pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, position, imgWidth, imgHeight, undefined, 'FAST');
  heightLeft -= pageHeight;

  // Additional pages if document is longer than single A4 page
  while (heightLeft > 0) {
    position = heightLeft - imgHeight;
    pdf.addPage();
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, position, imgWidth, imgHeight, undefined, 'FAST');
    heightLeft -= pageHeight;
  }

  const cleanFilename = (filename.endsWith('.pdf') ? filename : `${filename}.pdf`).replace(/[^a-zA-Z0-9_.-]/g, '_');
  pdf.save(cleanFilename);
}

