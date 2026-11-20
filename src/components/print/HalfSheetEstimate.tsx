import React from 'react';
import { renderEstimatePages } from '../../utils/estimatePrint.js';

export function HalfSheetEstimate({ voucher, settings, id, orientation = 'portrait', showBatches = true, showNarration = true, showSignatures = true }: {
  voucher: any; settings: any; id: string; orientation?: 'portrait' | 'landscape'; showBatches?: boolean; showNarration?: boolean; showSignatures?: boolean;
}) {
  const pages = renderEstimatePages(voucher, {
    orientation, showBatches: showBatches && (settings?.print?.showBatchDetails ?? false),
    showHsn: settings?.print?.showHsnSac ?? true,
    showDiscount: settings?.print?.showDiscountColumn ?? true,
    showNarration: false, showSignatory: showSignatures && (settings?.print?.showAuthorizedSignatory ?? true),
    signatoryLabel: settings?.print?.signatoryLabel,
  });
  const width = orientation === 'portrait' ? '148mm' : '210mm';
  const height = orientation === 'portrait' ? '209.5mm' : '147.5mm';
  return <div id={id} data-paper-size="a5" data-orientation={orientation} className="print-document-container half-sheet-estimate" style={{ width, maxWidth: 'none' }}>
    {pages.map((svg, index) => <div key={index} className="estimate-sheet" data-estimate-page={index + 1} style={{ width, height, background: 'white', position: 'relative', breakAfter: index === pages.length - 1 ? 'auto' : 'page', pageBreakAfter: index === pages.length - 1 ? 'auto' : 'always', marginBottom: '8px' }}>
      <div style={{ position: 'absolute', width: '94%', height: '94%', left: '3%', top: '3%' }} dangerouslySetInnerHTML={{ __html: svg.replace('style="', 'style="width:100%;height:100%;') }} />
    </div>)}
  </div>;
}
