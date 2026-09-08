import * as XLSX from 'xlsx';

export interface SampleOpticalBatchRow {
  unique_item: string;
  batch_name: string;
  sku: string;
  opening_stock_quantity: number | string;
  purchase_cost: number | string;
  selling_price: number | string;
  unit: string;
  barcode: string;
  supplier: string;
  purchase_date: string;
  batch_reference: string;
  expiry_date: string;
  location: string;
  reorder_level: number | string;
  remarks: string;
}

export const SAMPLE_OPTICAL_BATCH_ROWS: SampleOpticalBatchRow[] = [
  {
    unique_item: 'HC_SV_-6/-2',
    batch_name: '-6.00/-2.00',
    sku: 'HCSV-600-200',
    opening_stock_quantity: 10,
    purchase_cost: 100,
    selling_price: 250,
    unit: 'prs',
    barcode: '890000000001',
    supplier: 'ABC Optical',
    purchase_date: '2026-08-31',
    batch_reference: 'AB123',
    expiry_date: '',
    location: 'Main Store',
    reorder_level: 2,
    remarks: '',
  },
  {
    unique_item: 'HC_SV_+4/+2',
    batch_name: '+4.00/+2.00',
    sku: 'HCSV-400-200',
    opening_stock_quantity: 5,
    purchase_cost: 110,
    selling_price: 275,
    unit: 'prs',
    barcode: '890000000002',
    supplier: 'XYZ Optical',
    purchase_date: '2026-08-31',
    batch_reference: 'XY456',
    expiry_date: '',
    location: 'Main Store',
    reorder_level: 1,
    remarks: '',
  },
];

export const OPTICAL_BATCH_COLUMNS = [
  'unique_item',
  'batch_name',
  'sku',
  'opening_stock_quantity',
  'purchase_cost',
  'selling_price',
  'unit',
  'barcode',
  'supplier',
  'purchase_date',
  'batch_reference',
  'expiry_date',
  'location',
  'reorder_level',
  'remarks',
];

export const OPTICAL_BATCH_INSTRUCTIONS = [
  {
    column: 'unique_item',
    requirement: 'Required',
    format: 'HC_SV_-6/-2',
    description: 'Stock Item code/name. Must already exist in the software. Do NOT create a new Stock Item through Excel.',
  },
  {
    column: 'batch_name',
    requirement: 'Required',
    format: '-6.00/-2.00 or +4.00/+2.00',
    description: 'Batch/power identification belonging to the selected Stock Item.',
  },
  {
    column: 'sku',
    requirement: 'Required',
    format: 'HCSV-600-200',
    description: 'Unique SKU for the batch.',
  },
  {
    column: 'opening_stock_quantity',
    requirement: 'Required',
    format: '10, 0.5, 1, 1.5',
    description: 'Initial stock quantity to be added in pairs/pieces. Must be a positive value in steps of 0.5 (e.g., 0.5, 1, 1.5, 2).',
  },
  {
    column: 'purchase_cost',
    requirement: 'Required',
    format: '100',
    description: 'Purchase cost according to the existing stock/batch pricing structure.',
  },
  {
    column: 'selling_price',
    requirement: 'Required',
    format: '250',
    description: 'Selling price according to the existing pricing architecture. Do not create a second pricing system.',
  },
  {
    column: 'unit',
    requirement: 'Required',
    format: 'prs',
    description: 'Must use a unit supported by the application (prs, pairs, pcs, pieces). Default is prs.',
  },
  {
    column: 'barcode',
    requirement: 'Optional',
    format: '890000000001',
    description: 'Optional barcode. Must comply with the existing barcode rules (Standard Code 128 auto-generated if left empty).',
  },
  {
    column: 'supplier',
    requirement: 'Optional',
    format: 'ABC Optical',
    description: 'Optional supplier associated with the opening stock.',
  },
  {
    column: 'purchase_date',
    requirement: 'Optional',
    format: '2026-08-31',
    description: 'Optional purchase/opening-stock date (YYYY-MM-DD format).',
  },
  {
    column: 'batch_reference',
    requirement: 'Optional',
    format: 'AB123',
    description: 'Optional supplier/manufacturer batch reference.',
  },
  {
    column: 'expiry_date',
    requirement: 'Optional',
    format: '2028-12-31',
    description: 'Optional expiry date (YYYY-MM-DD format).',
  },
  {
    column: 'location',
    requirement: 'Optional',
    format: 'Main Store',
    description: 'Optional inventory location.',
  },
  {
    column: 'reorder_level',
    requirement: 'Optional',
    format: '2',
    description: 'Optional minimum stock threshold.',
  },
  {
    column: 'remarks',
    requirement: 'Optional',
    format: 'Opening balance',
    description: 'Optional notes or comments.',
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
    { wch: 18 }, // unique_item
    { wch: 16 }, // batch_name
    { wch: 18 }, // sku
    { wch: 24 }, // opening_stock_quantity
    { wch: 15 }, // purchase_cost
    { wch: 15 }, // selling_price
    { wch: 10 }, // unit
    { wch: 18 }, // barcode
    { wch: 18 }, // supplier
    { wch: 15 }, // purchase_date
    { wch: 18 }, // batch_reference
    { wch: 14 }, // expiry_date
    { wch: 16 }, // location
    { wch: 15 }, // reorder_level
    { wch: 22 }, // remarks
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
    { wch: 24 }, // Field Name
    { wch: 14 }, // Requirement
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

