import * as XLSX from 'xlsx';

export interface SampleOpticalBatchRow {
  'Stock Item': string;
  SPH: string | number;
  CYL: string | number;
  AXIS: string | number;
  ADD: string | number;
  SIDE: string;
  SKU: string;
  'Opening Stock Qty': number | string;
  'Purchase Cost': number | string;
  'Selling Price': number | string;
  Barcode: string;
  Supplier: string;
  Notes: string;
  Status: string;
}

export const SAMPLE_OPTICAL_BATCH_ROWS: SampleOpticalBatchRow[] = [
  {
    'Stock Item': 'HC SV -6/-2',
    SPH: '-2.50',
    CYL: '-1.00',
    AXIS: '',
    ADD: '',
    SIDE: '',
    SKU: 'HCSV-250-100',
    'Opening Stock Qty': 10,
    'Purchase Cost': 150.00,
    'Selling Price': 250.00,
    Barcode: '',
    Supplier: 'Vision Tech Distributors',
    Notes: 'Single vision stock lens',
    Status: 'ACTIVE',
  },
  {
    'Stock Item': 'BCG KT 2 CYL',
    SPH: '+1.00',
    CYL: '-2.00',
    AXIS: '90',
    ADD: '+2.00',
    SIDE: '',
    SKU: 'BCGKT-P100-M200-90-P200',
    'Opening Stock Qty': 5,
    'Purchase Cost': 280.00,
    'Selling Price': 450.00,
    Barcode: '',
    Supplier: 'Essilor India Pvt Ltd',
    Notes: 'Kryptok bifocal batch',
    Status: 'ACTIVE',
  },
  {
    'Stock Item': 'BCG PROG',
    SPH: '-2.00',
    CYL: '-1.00',
    AXIS: '180',
    ADD: '+2.00',
    SIDE: 'R',
    SKU: 'BCGPROG-M200-M100-180-P200-R',
    'Opening Stock Qty': 2,
    'Purchase Cost': 650.00,
    'Selling Price': 1100.00,
    Barcode: '',
    Supplier: 'Hoya Lens India',
    Notes: 'Progressive right eye',
    Status: 'ACTIVE',
  },
];

export const OPTICAL_BATCH_COLUMNS = [
  'Stock Item',
  'SPH',
  'CYL',
  'AXIS',
  'ADD',
  'SIDE',
  'SKU',
  'Opening Stock Qty',
  'Purchase Cost',
  'Selling Price',
  'Barcode',
  'Supplier',
  'Notes',
  'Status',
];

export const OPTICAL_BATCH_INSTRUCTIONS = [
  {
    column: 'Stock Item',
    requirement: 'Required',
    format: 'HC SV -6/-2, BCG KT 2 CYL',
    description: 'Stock Item code or name. Must already exist in the software. Stock Items cannot be auto-created.',
  },
  {
    column: 'SPH',
    requirement: 'Required',
    format: '-2.50, +1.00, 0.00',
    description: 'Spherical power in diopters. Required for Single Vision (SV), Kryptok (KT), and Progressive (PROG).',
  },
  {
    column: 'CYL',
    requirement: 'Required',
    format: '-1.00, -2.00, 0.00',
    description: 'Cylindrical power in diopters. Required for SV, KT, and PROG.',
  },
  {
    column: 'AXIS',
    requirement: 'Category-specific',
    format: '90, 180 (0 to 180)',
    description: 'Cylinder axis in degrees. Required for KT and PROG when CYL is non-zero. Must be blank for Single Vision (SV).',
  },
  {
    column: 'ADD',
    requirement: 'Category-specific',
    format: '+2.00, +1.50',
    description: 'Near addition power. Required for KT (Bifocal) and PROG (Progressive). Must be blank for Single Vision (SV).',
  },
  {
    column: 'SIDE',
    requirement: 'Category-specific',
    format: 'R, L, or BE',
    description: 'Eye side. Required for Progressive (PROG): "R" (Right), "L" (Left), or "BE" (Both Eyes). Must be blank for SV and KT.',
  },
  {
    column: 'SKU',
    requirement: 'Required',
    format: 'HCSV-250-100',
    description: 'Unique SKU identifier for the batch. Must be unique per business and per file.',
  },
  {
    column: 'Opening Stock Qty',
    requirement: 'Required',
    format: '10, 5, 2 (steps of 0.5 for PRS)',
    description: 'Initial stock quantity. For pair unit (PRS), must be in steps of 0.5 (e.g., 0.5, 1, 1.5, 2).',
  },
  {
    column: 'Purchase Cost',
    requirement: 'Required',
    format: '150.00',
    description: 'Procurement / purchase rate per unit (non-negative numeric).',
  },
  {
    column: 'Selling Price',
    requirement: 'Required',
    format: '250.00',
    description: 'Selling price / MRP per unit (non-negative numeric).',
  },
  {
    column: 'Barcode',
    requirement: 'Optional',
    format: 'OPT-SV-000101',
    description: 'Optional Code 128 permanent barcode. Standard unique barcode is auto-generated if left empty.',
  },
  {
    column: 'Supplier',
    requirement: 'Optional',
    format: 'Vision Tech Distributors',
    description: 'Optional supplier name or party code associated with the opening stock.',
  },
  {
    column: 'Notes',
    requirement: 'Optional',
    format: 'Single vision stock lens',
    description: 'Optional batch notes, lot references, or comments.',
  },
  {
    column: 'Status',
    requirement: 'Optional',
    format: 'ACTIVE',
    description: 'Batch lifecycle status. Allowed: ACTIVE, INACTIVE. Defaults to ACTIVE.',
  },
];

/**
 * Generates the sample Excel workbook entirely on the client side
 * without making any backend API requests or requiring authentication.
 */
export function generateClientOpticalBatchTemplate(): void {
  const wb = XLSX.utils.book_new();

  // 1. First worksheet: "Stock Import"
  const stockRows = [
    OPTICAL_BATCH_COLUMNS,
    ...SAMPLE_OPTICAL_BATCH_ROWS.map((row) =>
      OPTICAL_BATCH_COLUMNS.map((col) => (row as any)[col] ?? '')
    ),
  ];

  const wsStock = XLSX.utils.aoa_to_sheet(stockRows);

  // Set column widths for readability
  wsStock['!cols'] = [
    { wch: 22 }, // Stock Item
    { wch: 10 }, // SPH
    { wch: 10 }, // CYL
    { wch: 10 }, // AXIS
    { wch: 10 }, // ADD
    { wch: 10 }, // SIDE
    { wch: 22 }, // SKU
    { wch: 18 }, // Opening Stock Qty
    { wch: 15 }, // Purchase Cost
    { wch: 15 }, // Selling Price
    { wch: 18 }, // Barcode
    { wch: 25 }, // Supplier
    { wch: 28 }, // Notes
    { wch: 12 }, // Status
  ];

  XLSX.utils.book_append_sheet(wb, wsStock, 'Stock Import');

  // 2. Second worksheet: "Instructions"
  const instructionRows = [
    ['Field Name', 'Requirement', 'Format / Example', 'Description'],
    ...OPTICAL_BATCH_INSTRUCTIONS.map((inst) => [
      inst.column,
      inst.requirement,
      inst.format,
      inst.description,
    ]),
  ];

  const wsInstructions = XLSX.utils.aoa_to_sheet(instructionRows);
  wsInstructions['!cols'] = [
    { wch: 20 }, // Field Name
    { wch: 18 }, // Requirement
    { wch: 28 }, // Format / Example
    { wch: 85 }, // Description
  ];

  XLSX.utils.book_append_sheet(wb, wsInstructions, 'Instructions');

  // 3. Trigger direct browser download without API / network request
  const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([excelBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'Optical_Batch_Stock_Import_Template.xlsx';
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

export const STOCK_ITEM_COLUMNS = [
  'stock_item_code',
  'stock_item_name',
  'category',
  'maintain_batches',
  'unit',
  'status',
  'purchase_rate',
  'mrp',
  'gst_rate',
  'description',
  'parent_primary_item',
];

export const SAMPLE_STOCK_ITEM_ROWS = [
  {
    stock_item_code: 'CRZ-SV-156-HMC',
    stock_item_name: 'Crizal Alize 1.56 Single Vision Finished Lens',
    category: 'SV',
    maintain_batches: 'YES',
    unit: 'PRS',
    status: 'ACTIVE',
    purchase_rate: 450.0,
    mrp: 950.0,
    gst_rate: 5.0,
    description: 'Finished anti-reflective coated stock lens with hydrophobic topcoat',
    parent_primary_item: 'Crizal Alize 1.56 SV HMC',
  },
  {
    stock_item_code: 'ACC-MICROFIBER-5X5',
    stock_item_name: 'Premium Microfiber Lens Cleaning Cloth (5x5 inch)',
    category: 'OTHER',
    maintain_batches: 'NO',
    unit: 'PCS',
    status: 'ACTIVE',
    purchase_rate: 15.0,
    mrp: 50.0,
    gst_rate: 18.0,
    description: 'Ultra-soft lint-free cleaning cloth for eyewear and cameras',
    parent_primary_item: '',
  },
  {
    stock_item_code: 'SOL-LENS-CLEAN-50ML',
    stock_item_name: 'Anti-Fog Lens Spray Solution 50ml',
    category: 'OTHER',
    maintain_batches: 'NO',
    unit: 'PCS',
    status: 'ACTIVE',
    purchase_rate: 45.0,
    mrp: 120.0,
    gst_rate: 18.0,
    description: 'Alcohol-free anti-static spray solution',
    parent_primary_item: '',
  },
];

export const STOCK_ITEM_INSTRUCTIONS = [
  {
    column: 'stock_item_code',
    requirement: 'Mandatory',
    format: 'CRZ-SV-156-HMC',
    description: 'Unique Stock Item SKU Code. In CREATE_ONLY mode, must not already exist. In UPSERT mode, updates existing record.',
  },
  {
    column: 'stock_item_name',
    requirement: 'Mandatory',
    format: 'Crizal Alize 1.56 Single Vision Finished Lens',
    description: 'Descriptive commercial name of the Stock Item.',
  },
  {
    column: 'category',
    requirement: 'Mandatory',
    format: 'SV, KT, PROG, OTHER',
    description: 'Optical Type or Master Category code (SV, KT, PROG, OTHER).',
  },
  {
    column: 'maintain_batches',
    requirement: 'Mandatory',
    format: 'YES or NO',
    description: 'YES for power-tracked lenses (Single Vision, Bifocals, Progressives). NO for frames, sunglasses, accessories, solutions.',
  },
  {
    column: 'unit',
    requirement: 'Mandatory / Defaults to PRS',
    format: 'PRS or PCS',
    description: 'Stock Item Unit of Measure: PRS = Pairs (supports 0.5 fractions for lenses), PCS = Pieces (integers only). Defaults to PRS if blank.',
  },
  {
    column: 'status',
    requirement: 'Optional',
    format: 'ACTIVE or INACTIVE',
    description: 'Active status of the item. Defaults to ACTIVE.',
  },
  {
    column: 'purchase_rate',
    requirement: 'Optional',
    format: '450.00',
    description: 'Default vendor procurement cost in INR. Defaults to 0.00.',
  },
  {
    column: 'mrp',
    requirement: 'Optional',
    format: '950.00',
    description: 'Maximum Retail Price in INR. Defaults to 0.00.',
  },
  {
    column: 'gst_rate',
    requirement: 'Optional',
    format: '5, 12, 18, 28, or 0',
    description: 'Applicable GST percentage. Standard default is 5.00%.',
  },
  {
    column: 'description',
    requirement: 'Optional',
    format: 'Finished anti-reflective coated lens...',
    description: 'Detailed specifications, packaging details, or internal notes.',
  },
  {
    column: 'parent_primary_item',
    requirement: 'Optional',
    format: 'Crizal Alize 1.56 SV HMC',
    description: 'Name or Code of the Parent Primary Item / Legacy Master. Leave blank if none.',
  },
];

export function generateClientStockItemTemplate(): void {
  const wb = XLSX.utils.book_new();

  // 1. First worksheet: "Stock Items"
  const itemRows = [
    STOCK_ITEM_COLUMNS,
    ...SAMPLE_STOCK_ITEM_ROWS.map((row) =>
      STOCK_ITEM_COLUMNS.map((col) => (row as any)[col] ?? '')
    ),
  ];

  const wsItems = XLSX.utils.aoa_to_sheet(itemRows);

  wsItems['!cols'] = [
    { wch: 24 }, // stock_item_code
    { wch: 45 }, // stock_item_name
    { wch: 15 }, // category
    { wch: 18 }, // maintain_batches
    { wch: 12 }, // unit
    { wch: 12 }, // status
    { wch: 15 }, // purchase_rate
    { wch: 15 }, // mrp
    { wch: 12 }, // gst_rate
    { wch: 55 }, // description
    { wch: 28 }, // parent_primary_item
  ];

  XLSX.utils.book_append_sheet(wb, wsItems, 'Stock Items');

  // 2. Second worksheet: "Instructions & Rules"
  const instructionRows = [
    ['Column / Field Name', 'Requirement', 'Valid Values & Format', 'Description & Safety Rules'],
    ...STOCK_ITEM_INSTRUCTIONS.map((inst) => [
      inst.column,
      inst.requirement,
      inst.format,
      inst.description,
    ]),
  ];

  const wsInstructions = XLSX.utils.aoa_to_sheet(instructionRows);
  wsInstructions['!cols'] = [
    { wch: 24 }, // Field Name
    { wch: 14 }, // Requirement
    { wch: 32 }, // Format
    { wch: 90 }, // Description
  ];

  XLSX.utils.book_append_sheet(wb, wsInstructions, 'Instructions & Rules');

  const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([excelBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'Stock_Items_Bulk_Import_Template.xlsx';
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

