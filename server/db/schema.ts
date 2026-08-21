import { pgTable, text, varchar, boolean, timestamp, uuid, jsonb, index, uniqueIndex, numeric } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

/**
 * 1. Businesses / Companies Table
 * Multi-tenant isolation anchor for all business data.
 */
export const businesses = pgTable('businesses', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  tradeName: varchar('trade_name', { length: 255 }),
  gstin: varchar('gstin', { length: 15 }),
  pan: varchar('pan', { length: 10 }),
  email: varchar('email', { length: 255 }),
  phone: varchar('phone', { length: 20 }),
  addressLine1: text('address_line1'),
  addressLine2: text('address_line2'),
  city: varchar('city', { length: 100 }),
  state: varchar('state', { length: 100 }),
  stateCode: varchar('state_code', { length: 5 }),
  pincode: varchar('pincode', { length: 10 }),
  currency: varchar('currency', { length: 10 }).default('INR').notNull(),
  financialYearStart: varchar('financial_year_start', { length: 10 }).default('04-01').notNull(),
  status: varchar('status', { length: 20 }).default('ACTIVE').notNull(), // ACTIVE, SUSPENDED, ARCHIVED
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  createdBy: uuid('created_by'),
}, (table) => [
  index('businesses_status_idx').on(table.status),
  index('businesses_gstin_idx').on(table.gstin),
]);

/**
 * 2. Users Table
 * Authentication and master user profiles.
 */
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  username: varchar('username', { length: 100 }).notNull().unique(),
  email: varchar('email', { length: 255 }).unique(),
  mobile: varchar('mobile', { length: 20 }).unique(),
  fullName: varchar('full_name', { length: 255 }).notNull(),
  passwordHash: text('password_hash').notNull(),
  status: varchar('status', { length: 20 }).default('ACTIVE').notNull(), // ACTIVE, INACTIVE, LOCKED
  isSuperAdmin: boolean('is_super_admin').default(false).notNull(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  createdBy: uuid('created_by'),
}, (table) => [
  uniqueIndex('users_username_idx').on(table.username),
  index('users_email_idx').on(table.email),
  index('users_mobile_idx').on(table.mobile),
  index('users_status_idx').on(table.status),
]);

/**
 * 3. Roles Table
 * System default roles and business-customized roles.
 */
export const roles = pgTable('roles', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id').references(() => businesses.id, { onDelete: 'cascade' }), // Null if system-wide role
  name: varchar('name', { length: 100 }).notNull(),
  code: varchar('code', { length: 50 }).notNull(), // SUPER_ADMIN, MANAGER, SALES_USER, PURCHASE_USER, INVENTORY_USER, ACCOUNTS_USER, VIEWER
  description: text('description'),
  isSystem: boolean('is_system').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('roles_business_id_idx').on(table.businessId),
  index('roles_code_idx').on(table.code),
]);

/**
 * 4. Permissions Table
 * Granular action permissions across all modules.
 */
export const permissions = pgTable('permissions', {
  id: uuid('id').defaultRandom().primaryKey(),
  module: varchar('module', { length: 50 }).notNull(), // sales, purchase, inventory, parties, accounts, reports, admin, settings
  action: varchar('action', { length: 50 }).notNull(),
  code: varchar('code', { length: 100 }).notNull().unique(), // e.g. "sales:create", "inventory:adjust_stock"
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('permissions_code_idx').on(table.code),
  index('permissions_module_idx').on(table.module),
]);

/**
 * 5. Role Permissions Junction Table
 * Maps permissions to roles.
 */
export const rolePermissions = pgTable('role_permissions', {
  id: uuid('id').defaultRandom().primaryKey(),
  roleId: uuid('role_id').references(() => roles.id, { onDelete: 'cascade' }).notNull(),
  permissionId: uuid('permission_id').references(() => permissions.id, { onDelete: 'cascade' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('role_permissions_role_perm_idx').on(table.roleId, table.permissionId),
  index('role_permissions_role_id_idx').on(table.roleId),
  index('role_permissions_perm_id_idx').on(table.permissionId),
]);

/**
 * 6. User Business Access
 * Authorizes a user to access specific businesses.
 */
export const userBusinessAccess = pgTable('user_business_access', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  businessId: uuid('business_id').references(() => businesses.id, { onDelete: 'cascade' }).notNull(),
  isDefault: boolean('is_default').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('user_biz_access_user_biz_idx').on(table.userId, table.businessId),
  index('user_biz_access_user_id_idx').on(table.userId),
  index('user_biz_access_business_id_idx').on(table.businessId),
]);

/**
 * 7. User Roles Table
 * Assigns roles to users for a specific business.
 */
export const userRoles = pgTable('user_roles', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  businessId: uuid('business_id').references(() => businesses.id, { onDelete: 'cascade' }).notNull(),
  roleId: uuid('role_id').references(() => roles.id, { onDelete: 'cascade' }).notNull(),
  assignedBy: uuid('assigned_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('user_roles_user_biz_role_idx').on(table.userId, table.businessId, table.roleId),
  index('user_roles_user_id_idx').on(table.userId),
  index('user_roles_business_id_idx').on(table.businessId),
  index('user_roles_role_id_idx').on(table.roleId),
]);

/**
 * 8. Audit Logs Table
 * Immutable log of critical business events and modifications.
 */
export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id').references(() => businesses.id, { onDelete: 'set null' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  action: varchar('action', { length: 50 }).notNull(), // CREATE, UPDATE, DELETE, LOGIN, LOGOUT, CANCEL, APPROVE, ADJUST_STOCK
  module: varchar('module', { length: 50 }).notNull(), // AUTH, USERS, ROLES, BUSINESS, SALES, PURCHASE, INVENTORY, ACCOUNTS
  entityType: varchar('entity_type', { length: 100 }).notNull(), // User, Business, Role, Invoice, StockItem, etc.
  entityId: varchar('entity_id', { length: 100 }),
  previousValue: jsonb('previous_value'),
  newValue: jsonb('new_value'),
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('audit_logs_business_id_idx').on(table.businessId),
  index('audit_logs_user_id_idx').on(table.userId),
  index('audit_logs_created_at_idx').on(table.createdAt),
  index('audit_logs_module_idx').on(table.module),
  index('audit_logs_action_idx').on(table.action),
]);

/**
 * Relational Definitions for Drizzle ORM Query API
 */
export const businessesRelations = relations(businesses, ({ many }) => ({
  roles: many(roles),
  userAccess: many(userBusinessAccess),
  userRoles: many(userRoles),
  auditLogs: many(auditLogs),
}));

export const usersRelations = relations(users, ({ many }) => ({
  businessAccess: many(userBusinessAccess),
  userRoles: many(userRoles),
  auditLogs: many(auditLogs),
}));

export const rolesRelations = relations(roles, ({ one, many }) => ({
  business: one(businesses, {
    fields: [roles.businessId],
    references: [businesses.id],
  }),
  rolePermissions: many(rolePermissions),
  userRoles: many(userRoles),
}));

export const permissionsRelations = relations(permissions, ({ many }) => ({
  rolePermissions: many(rolePermissions),
}));

export const rolePermissionsRelations = relations(rolePermissions, ({ one }) => ({
  role: one(roles, {
    fields: [rolePermissions.roleId],
    references: [roles.id],
  }),
  permission: one(permissions, {
    fields: [rolePermissions.permissionId],
    references: [permissions.id],
  }),
}));

export const userBusinessAccessRelations = relations(userBusinessAccess, ({ one }) => ({
  user: one(users, {
    fields: [userBusinessAccess.userId],
    references: [users.id],
  }),
  business: one(businesses, {
    fields: [userBusinessAccess.businessId],
    references: [businesses.id],
  }),
}));

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, {
    fields: [userRoles.userId],
    references: [users.id],
  }),
  business: one(businesses, {
    fields: [userRoles.businessId],
    references: [businesses.id],
  }),
  role: one(roles, {
    fields: [userRoles.roleId],
    references: [roles.id],
  }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  business: one(businesses, {
    fields: [auditLogs.businessId],
    references: [businesses.id],
  }),
  user: one(users, {
    fields: [auditLogs.userId],
    references: [users.id],
  }),
}));

/**
 * 9. Categories Master
 * Single Vision (SV), Kryptok Bifocal (KT), Progressive Lens (PROG)
 */
export const categories = pgTable('categories', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id').references(() => businesses.id, { onDelete: 'cascade' }), // Null for system global master, or scoped to business
  name: varchar('name', { length: 100 }).notNull(),
  code: varchar('code', { length: 50 }).notNull(), // SV, KT, PROG
  description: text('description'),
  status: varchar('status', { length: 20 }).default('ACTIVE').notNull(), // ACTIVE, INACTIVE
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
}, (table) => [
  uniqueIndex('categories_biz_code_idx').on(table.businessId, table.code),
  index('categories_business_id_idx').on(table.businessId),
  index('categories_status_idx').on(table.status),
  index('categories_code_idx').on(table.code),
]);

/**
 * 10. Coatings Master
 * HC, HMC, BCG, BCB, BCD, BCM, BCLRB, PGHC, BCPGHC, PCBCG, PCBCB, PCBCD, etc.
 */
export const coatings = pgTable('coatings', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id').references(() => businesses.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  code: varchar('code', { length: 50 }).notNull(),
  description: text('description'),
  status: varchar('status', { length: 20 }).default('ACTIVE').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
}, (table) => [
  uniqueIndex('coatings_biz_code_idx').on(table.businessId, table.code),
  index('coatings_business_id_idx').on(table.businessId),
  index('coatings_status_idx').on(table.status),
  index('coatings_code_idx').on(table.code),
]);

/**
 * 11. Bases Master
 * Optical product base material/family (CLEAR, BLUE CUT, PHOTOGREY, BLUE CUT PHOTOGREY, POLY BLUE CUT, etc.)
 */
export const bases = pgTable('bases', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id').references(() => businesses.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  code: varchar('code', { length: 50 }).notNull(),
  family: varchar('family', { length: 100 }), // CLEAR, BLUE CUT, PHOTOGREY, BLUE CUT PHOTOGREY, POLY BLUE CUT
  coatingId: uuid('coating_id').references(() => coatings.id, { onDelete: 'set null' }),
  description: text('description'),
  status: varchar('status', { length: 20 }).default('ACTIVE').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
}, (table) => [
  uniqueIndex('bases_biz_code_idx').on(table.businessId, table.code),
  index('bases_business_id_idx').on(table.businessId),
  index('bases_status_idx').on(table.status),
  index('bases_code_idx').on(table.code),
  index('bases_coating_id_idx').on(table.coatingId),
]);

/**
 * 12. Base Category Compatibility Junction Table
 * Defines which Bases are compatible with which Categories
 */
export const baseCategories = pgTable('base_categories', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id').references(() => businesses.id, { onDelete: 'cascade' }),
  baseId: uuid('base_id').references(() => bases.id, { onDelete: 'cascade' }).notNull(),
  categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'cascade' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('base_cat_biz_base_cat_idx').on(table.businessId, table.baseId, table.categoryId),
  index('base_categories_base_id_idx').on(table.baseId),
  index('base_categories_cat_id_idx').on(table.categoryId),
  index('base_categories_biz_id_idx').on(table.businessId),
]);

/**
 * 13. Primary Item Master
 * Main sellable optical product identity (e.g. HC SV, BCG SV, PG HC KT, PG HC PROG)
 */
export const primaryItems = pgTable('primary_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id').references(() => businesses.id, { onDelete: 'cascade' }).notNull(),
  categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'restrict' }).notNull(),
  baseId: uuid('base_id').references(() => bases.id, { onDelete: 'restrict' }).notNull(),
  coatingId: uuid('coating_id').references(() => coatings.id, { onDelete: 'set null' }),
  name: varchar('name', { length: 255 }).notNull(),
  code: varchar('code', { length: 100 }).notNull(),
  description: text('description'),
  status: varchar('status', { length: 20 }).default('ACTIVE').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
}, (table) => [
  uniqueIndex('primary_items_biz_code_idx').on(table.businessId, table.code),
  index('primary_items_biz_idx').on(table.businessId),
  index('primary_items_cat_idx').on(table.categoryId),
  index('primary_items_base_idx').on(table.baseId),
  index('primary_items_coating_idx').on(table.coatingId),
  index('primary_items_status_idx').on(table.status),
]);

/**
 * 14. Unique Item Master
 * Distinct entity below Primary Item for grouping variants, purchase rates, and batch grouping.
 */
export const uniqueItems = pgTable('unique_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id').references(() => businesses.id, { onDelete: 'cascade' }).notNull(),
  primaryItemId: uuid('primary_item_id').references(() => primaryItems.id, { onDelete: 'cascade' }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  code: varchar('code', { length: 100 }).notNull(),
  description: text('description'),
  purchaseRate: numeric('purchase_rate', { precision: 12, scale: 2 }).default('0.00'),
  lastPurchasePrice: numeric('last_purchase_price', { precision: 12, scale: 2 }).default('0.00'),
  mrp: numeric('mrp', { precision: 12, scale: 2 }).default('0.00'),
  status: varchar('status', { length: 20 }).default('ACTIVE').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
}, (table) => [
  uniqueIndex('unique_items_biz_code_idx').on(table.businessId, table.code),
  index('unique_items_biz_idx').on(table.businessId),
  index('unique_items_primary_idx').on(table.primaryItemId),
  index('unique_items_status_idx').on(table.status),
]);

/**
 * 15. Optical Batches
 * Permanent optical identity for one exact power combination with permanent barcode.
 * SV: SPH, CYL (AXIS = 0, ADD = 0, SIDE = NONE)
 * KT: SPH, CYL, AXIS, ADD (SIDE = NONE)
 * PROG: SPH, CYL, AXIS, ADD, SIDE (R, L, BE)
 */
export const opticalBatches = pgTable('optical_batches', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id').references(() => businesses.id, { onDelete: 'cascade' }).notNull(),
  uniqueItemId: uuid('unique_item_id').references(() => uniqueItems.id, { onDelete: 'cascade' }).notNull(),
  categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'restrict' }).notNull(),
  barcode: varchar('barcode', { length: 100 }).notNull(),
  
  // Power coordinates (stored as exact numerical values)
  sph: numeric('sph', { precision: 6, scale: 2 }).notNull(),
  cyl: numeric('cyl', { precision: 6, scale: 2 }).notNull(),
  axis: numeric('axis', { precision: 5, scale: 1 }).default('0.0').notNull(),
  add: numeric('add', { precision: 5, scale: 2 }).default('0.00').notNull(),
  side: varchar('side', { length: 10 }).default('NONE').notNull(), // NONE, R, L, BE
  
  identityKey: varchar('identity_key', { length: 255 }).notNull(),
  status: varchar('status', { length: 20 }).default('ACTIVE').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
}, (table) => [
  uniqueIndex('optical_batches_barcode_idx').on(table.barcode),
  uniqueIndex('optical_batches_biz_identity_idx').on(table.businessId, table.identityKey),
  index('optical_batches_biz_idx').on(table.businessId),
  index('optical_batches_unique_item_idx').on(table.uniqueItemId),
  index('optical_batches_category_idx').on(table.categoryId),
  index('optical_batches_status_idx').on(table.status),
  index('optical_batches_powers_idx').on(table.sph, table.cyl, table.axis, table.add, table.side),
]);

/**
 * 16. Optical Stocks
 * Physical, Reserved, and Available Stock for each Optical Batch.
 * Formula: availableStock = physicalStock - reservedStock
 * Measured in pairs (supports fractional values: 0.5, 1.0, 1.5, 2.0, etc.)
 */
export const opticalStocks = pgTable('optical_stocks', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id').references(() => businesses.id, { onDelete: 'cascade' }).notNull(),
  batchId: uuid('batch_id').references(() => opticalBatches.id, { onDelete: 'cascade' }).notNull(),
  physicalStock: numeric('physical_stock', { precision: 12, scale: 2 }).default('0.00').notNull(),
  reservedStock: numeric('reserved_stock', { precision: 12, scale: 2 }).default('0.00').notNull(),
  availableStock: numeric('available_stock', { precision: 12, scale: 2 }).default('0.00').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('optical_stocks_biz_batch_idx').on(table.businessId, table.batchId),
  index('optical_stocks_biz_idx').on(table.businessId),
  index('optical_stocks_batch_idx').on(table.batchId),
]);

/**
 * 17. Stock Ledger
 * Immutable audit trail of every stock entry, exit, adjustment, and reservation.
 */
export const stockLedger = pgTable('stock_ledger', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id').references(() => businesses.id, { onDelete: 'cascade' }).notNull(),
  batchId: uuid('batch_id').references(() => opticalBatches.id, { onDelete: 'cascade' }).notNull(),
  transactionType: varchar('transaction_type', { length: 50 }).notNull(), // OPENING_STOCK, PURCHASE, PURCHASE_RETURN, SALE, SALES_RETURN, STOCK_ADJUSTMENT, STOCK_TRANSFER, RESERVATION, RESERVATION_RELEASE, RESERVATION_CONVERSION, CANCELLATION_REVERSAL
  referenceType: varchar('reference_type', { length: 50 }), // INVOICE, BILL, MANUAL, TRANSFER, ADJUSTMENT
  referenceId: varchar('reference_id', { length: 100 }),
  quantityIn: numeric('quantity_in', { precision: 12, scale: 2 }).default('0.00').notNull(),
  quantityOut: numeric('quantity_out', { precision: 12, scale: 2 }).default('0.00').notNull(),
  reservedIn: numeric('reserved_in', { precision: 12, scale: 2 }).default('0.00').notNull(),
  reservedOut: numeric('reserved_out', { precision: 12, scale: 2 }).default('0.00').notNull(),
  balance: numeric('balance', { precision: 12, scale: 2 }).notNull(),
  reason: text('reason'),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('stock_ledger_biz_idx').on(table.businessId),
  index('stock_ledger_batch_idx').on(table.batchId),
  index('stock_ledger_type_idx').on(table.transactionType),
  index('stock_ledger_created_at_idx').on(table.createdAt),
]);

/**
 * 17B. Stock Reservations
 * Holds active reservations against optical batches without deducting physical stock.
 * Available stock decreases when reserved.
 */
export const stockReservations = pgTable('stock_reservations', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id').references(() => businesses.id, { onDelete: 'cascade' }).notNull(),
  batchId: uuid('batch_id').references(() => opticalBatches.id, { onDelete: 'cascade' }).notNull(),
  quantity: numeric('quantity', { precision: 12, scale: 2 }).notNull(), // pairs
  status: varchar('status', { length: 20 }).default('ACTIVE').notNull(), // ACTIVE, RELEASED, CONVERTED, CANCELLED
  referenceType: varchar('reference_type', { length: 50 }).default('MANUAL_HOLD').notNull(), // MANUAL_HOLD, SALES_ORDER, CUSTOMER_HOLD, PATIENT_HOLD, RX_HOLD
  referenceId: varchar('reference_id', { length: 100 }),
  notes: text('notes'),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  releasedAt: timestamp('released_at', { withTimezone: true }),
  convertedAt: timestamp('converted_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
}, (table) => [
  index('stock_reservations_biz_idx').on(table.businessId),
  index('stock_reservations_batch_idx').on(table.batchId),
  index('stock_reservations_status_idx').on(table.status),
  index('stock_reservations_created_at_idx').on(table.createdAt),
]);

/**
 * Relations for Master Data & Inventory
 */
export const categoriesRelations = relations(categories, ({ many }) => ({
  primaryItems: many(primaryItems),
  baseCategories: many(baseCategories),
  opticalBatches: many(opticalBatches),
}));

export const coatingsRelations = relations(coatings, ({ many }) => ({
  bases: many(bases),
  primaryItems: many(primaryItems),
}));

export const basesRelations = relations(bases, ({ one, many }) => ({
  coating: one(coatings, {
    fields: [bases.coatingId],
    references: [coatings.id],
  }),
  baseCategories: many(baseCategories),
  primaryItems: many(primaryItems),
}));

export const baseCategoriesRelations = relations(baseCategories, ({ one }) => ({
  base: one(bases, {
    fields: [baseCategories.baseId],
    references: [bases.id],
  }),
  category: one(categories, {
    fields: [baseCategories.categoryId],
    references: [categories.id],
  }),
}));

export const primaryItemsRelations = relations(primaryItems, ({ one, many }) => ({
  category: one(categories, {
    fields: [primaryItems.categoryId],
    references: [categories.id],
  }),
  base: one(bases, {
    fields: [primaryItems.baseId],
    references: [bases.id],
  }),
  coating: one(coatings, {
    fields: [primaryItems.coatingId],
    references: [coatings.id],
  }),
  uniqueItems: many(uniqueItems),
}));

export const uniqueItemsRelations = relations(uniqueItems, ({ one, many }) => ({
  primaryItem: one(primaryItems, {
    fields: [uniqueItems.primaryItemId],
    references: [primaryItems.id],
  }),
  opticalBatches: many(opticalBatches),
}));

export const opticalBatchesRelations = relations(opticalBatches, ({ one, many }) => ({
  uniqueItem: one(uniqueItems, {
    fields: [opticalBatches.uniqueItemId],
    references: [uniqueItems.id],
  }),
  category: one(categories, {
    fields: [opticalBatches.categoryId],
    references: [categories.id],
  }),
  stock: one(opticalStocks, {
    fields: [opticalBatches.id],
    references: [opticalStocks.batchId],
  }),
  ledgerEntries: many(stockLedger),
  reservations: many(stockReservations),
}));

export const opticalStocksRelations = relations(opticalStocks, ({ one }) => ({
  batch: one(opticalBatches, {
    fields: [opticalStocks.batchId],
    references: [opticalBatches.id],
  }),
}));

export const stockLedgerRelations = relations(stockLedger, ({ one }) => ({
  batch: one(opticalBatches, {
    fields: [stockLedger.batchId],
    references: [opticalBatches.id],
  }),
}));

export const stockReservationsRelations = relations(stockReservations, ({ one }) => ({
  batch: one(opticalBatches, {
    fields: [stockReservations.batchId],
    references: [opticalBatches.id],
  }),
  business: one(businesses, {
    fields: [stockReservations.businessId],
    references: [businesses.id],
  }),
}));

/**
 * 18. Parties Master
 * Unified party master for Customers, Suppliers, and Both.
 */
export const parties = pgTable('parties', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id').references(() => businesses.id, { onDelete: 'cascade' }).notNull(),
  partyCode: varchar('party_code', { length: 50 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  displayName: varchar('display_name', { length: 255 }),
  partyType: varchar('party_type', { length: 20 }).notNull(), // CUSTOMER, SUPPLIER, BOTH
  mobile: varchar('mobile', { length: 20 }),
  alternateMobile: varchar('alternate_mobile', { length: 20 }),
  email: varchar('email', { length: 255 }),
  addressLine1: text('address_line_1'),
  addressLine2: text('address_line_2'),
  city: varchar('city', { length: 100 }),
  state: varchar('state', { length: 100 }),
  pincode: varchar('pincode', { length: 10 }),
  country: varchar('country', { length: 100 }).default('India'),
  gstin: varchar('gstin', { length: 15 }),
  pan: varchar('pan', { length: 10 }),
  creditLimit: numeric('credit_limit', { precision: 12, scale: 2 }).default('0.00'),
  creditDays: varchar('credit_days', { length: 10 }).default('0'),
  status: varchar('status', { length: 20 }).default('ACTIVE').notNull(), // ACTIVE, INACTIVE
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
}, (table) => [
  uniqueIndex('parties_biz_code_idx').on(table.businessId, table.partyCode),
  index('parties_biz_idx').on(table.businessId),
  index('parties_type_idx').on(table.partyType),
  index('parties_status_idx').on(table.status),
  index('parties_mobile_idx').on(table.mobile),
  index('parties_gstin_idx').on(table.gstin),
]);

/**
 * 19. Purchase Invoices
 * Vendor procurement bills and stock inward vouchers.
 */
export const purchaseInvoices = pgTable('purchase_invoices', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id').references(() => businesses.id, { onDelete: 'cascade' }).notNull(),
  supplierPartyId: uuid('supplier_party_id').references(() => parties.id, { onDelete: 'restrict' }).notNull(),
  invoiceNumber: varchar('invoice_number', { length: 50 }).notNull(), // Internal e.g. PUR-000001
  invoiceDate: timestamp('invoice_date', { withTimezone: true }).notNull(),
  supplierInvoiceNumber: varchar('supplier_invoice_number', { length: 100 }), // Vendor external bill no.
  supplierInvoiceDate: timestamp('supplier_invoice_date', { withTimezone: true }),
  gstMode: varchar('gst_mode', { length: 20 }).default('INTRA_STATE').notNull(), // INTRA_STATE, INTER_STATE
  
  // Financial amounts
  subtotal: numeric('subtotal', { precision: 12, scale: 2 }).default('0.00').notNull(),
  discountTotal: numeric('discount_total', { precision: 12, scale: 2 }).default('0.00').notNull(),
  taxableAmount: numeric('taxable_amount', { precision: 12, scale: 2 }).default('0.00').notNull(),
  igstRate: numeric('igst_rate', { precision: 5, scale: 2 }).default('0.00').notNull(),
  igstAmount: numeric('igst_amount', { precision: 12, scale: 2 }).default('0.00').notNull(),
  cgstRate: numeric('cgst_rate', { precision: 5, scale: 2 }).default('0.00').notNull(),
  cgstAmount: numeric('cgst_amount', { precision: 12, scale: 2 }).default('0.00').notNull(),
  sgstRate: numeric('sgst_rate', { precision: 5, scale: 2 }).default('0.00').notNull(),
  sgstAmount: numeric('sgst_amount', { precision: 12, scale: 2 }).default('0.00').notNull(),
  roundOff: numeric('round_off', { precision: 8, scale: 2 }).default('0.00').notNull(),
  grandTotal: numeric('grand_total', { precision: 12, scale: 2 }).default('0.00').notNull(),
  
  paymentStatus: varchar('payment_status', { length: 20 }).default('UNPAID').notNull(), // UNPAID, PARTIAL, PAID
  status: varchar('status', { length: 20 }).default('DRAFT').notNull(), // DRAFT, POSTED, CANCELLED
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
}, (table) => [
  uniqueIndex('purchase_invoices_biz_num_idx').on(table.businessId, table.invoiceNumber),
  index('purchase_invoices_biz_idx').on(table.businessId),
  index('purchase_invoices_supplier_idx').on(table.supplierPartyId),
  index('purchase_invoices_date_idx').on(table.invoiceDate),
  index('purchase_invoices_status_idx').on(table.status),
]);

/**
 * 20. Purchase Invoice Lines
 * Item rows under a purchase invoice.
 */
export const purchaseInvoiceLines = pgTable('purchase_invoice_lines', {
  id: uuid('id').defaultRandom().primaryKey(),
  purchaseInvoiceId: uuid('purchase_invoice_id').references(() => purchaseInvoices.id, { onDelete: 'cascade' }).notNull(),
  uniqueItemId: uuid('unique_item_id').references(() => uniqueItems.id, { onDelete: 'restrict' }).notNull(),
  quantity: numeric('quantity', { precision: 12, scale: 2 }).notNull(), // in pairs (e.g. 0.5, 1.0, 10.0)
  rate: numeric('rate', { precision: 12, scale: 2 }).notNull(), // Purchase rate per pair
  discountType: varchar('discount_type', { length: 20 }).default('NONE').notNull(), // NONE, PERCENTAGE, FIXED
  discountValue: numeric('discount_value', { precision: 12, scale: 2 }).default('0.00').notNull(),
  discountAmount: numeric('discount_amount', { precision: 12, scale: 2 }).default('0.00').notNull(),
  taxableAmount: numeric('taxable_amount', { precision: 12, scale: 2 }).notNull(),
  gstRate: numeric('gst_rate', { precision: 5, scale: 2 }).default('0.00').notNull(), // e.g. 5.00, 12.00, 18.00
  taxAmount: numeric('tax_amount', { precision: 12, scale: 2 }).default('0.00').notNull(),
  lineTotal: numeric('line_total', { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('purchase_lines_invoice_idx').on(table.purchaseInvoiceId),
  index('purchase_lines_item_idx').on(table.uniqueItemId),
]);

/**
 * 21. Purchase Invoice Line Batches
 * Specific optical power allocations belonging to a purchase row.
 */
export const purchaseInvoiceLineBatches = pgTable('purchase_invoice_line_batches', {
  id: uuid('id').defaultRandom().primaryKey(),
  purchaseInvoiceLineId: uuid('purchase_invoice_line_id').references(() => purchaseInvoiceLines.id, { onDelete: 'cascade' }).notNull(),
  batchId: uuid('batch_id').references(() => opticalBatches.id, { onDelete: 'restrict' }).notNull(),
  quantity: numeric('quantity', { precision: 12, scale: 2 }).notNull(), // in pairs
  rate: numeric('rate', { precision: 12, scale: 2 }).notNull(),
  totalCost: numeric('total_cost', { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('purchase_line_batches_line_idx').on(table.purchaseInvoiceLineId),
  index('purchase_line_batches_batch_idx').on(table.batchId),
]);

/**
 * 22. Purchase Lots
 * Historical lot record preserving each purchase price and remaining stock.
 */
export const purchaseLots = pgTable('purchase_lots', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id').references(() => businesses.id, { onDelete: 'cascade' }).notNull(),
  purchaseInvoiceId: uuid('purchase_invoice_id').references(() => purchaseInvoices.id, { onDelete: 'cascade' }).notNull(),
  purchaseInvoiceLineId: uuid('purchase_invoice_line_id').references(() => purchaseInvoiceLines.id, { onDelete: 'cascade' }).notNull(),
  batchId: uuid('batch_id').references(() => opticalBatches.id, { onDelete: 'restrict' }).notNull(),
  uniqueItemId: uuid('unique_item_id').references(() => uniqueItems.id, { onDelete: 'restrict' }).notNull(),
  quantityReceived: numeric('quantity_received', { precision: 12, scale: 2 }).notNull(),
  rate: numeric('rate', { precision: 12, scale: 2 }).notNull(),
  taxRate: numeric('tax_rate', { precision: 5, scale: 2 }).default('0.00').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
  remainingQuantity: numeric('remaining_quantity', { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('purchase_lots_biz_idx').on(table.businessId),
  index('purchase_lots_invoice_idx').on(table.purchaseInvoiceId),
  index('purchase_lots_item_idx').on(table.uniqueItemId),
  index('purchase_lots_batch_idx').on(table.batchId),
]);

/**
 * 23. Supplier / Party Ledgers
 * Running balance ledger for vendors and parties.
 */
export const supplierLedgers = pgTable('supplier_ledgers', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id').references(() => businesses.id, { onDelete: 'cascade' }).notNull(),
  partyId: uuid('party_id').references(() => parties.id, { onDelete: 'restrict' }).notNull(),
  transactionType: varchar('transaction_type', { length: 50 }).notNull(), // OPENING_BALANCE, PURCHASE, PURCHASE_RETURN, PAYMENT, DEBIT_NOTE, CREDIT_NOTE, ADJUSTMENT, CANCELLATION_REVERSAL
  referenceType: varchar('reference_type', { length: 50 }), // PURCHASE_INVOICE, PAYMENT_VOUCHER, etc.
  referenceId: varchar('reference_id', { length: 100 }),
  debit: numeric('debit', { precision: 12, scale: 2 }).default('0.00').notNull(),
  credit: numeric('credit', { precision: 12, scale: 2 }).default('0.00').notNull(),
  balance: numeric('balance', { precision: 12, scale: 2 }).notNull(),
  transactionDate: timestamp('transaction_date', { withTimezone: true }).defaultNow().notNull(),
  notes: text('notes'),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('supplier_ledgers_biz_idx').on(table.businessId),
  index('supplier_ledgers_party_idx').on(table.partyId),
  index('supplier_ledgers_type_idx').on(table.transactionType),
  index('supplier_ledgers_date_idx').on(table.transactionDate),
]);

/**
 * Relations for Phase 2: Parties, Purchases, and Supplier Ledgers
 */
export const partiesRelations = relations(parties, ({ many }) => ({
  purchaseInvoices: many(purchaseInvoices),
  ledgerEntries: many(supplierLedgers),
}));

export const purchaseInvoicesRelations = relations(purchaseInvoices, ({ one, many }) => ({
  supplier: one(parties, {
    fields: [purchaseInvoices.supplierPartyId],
    references: [parties.id],
  }),
  lines: many(purchaseInvoiceLines),
  lots: many(purchaseLots),
}));

export const purchaseInvoiceLinesRelations = relations(purchaseInvoiceLines, ({ one, many }) => ({
  invoice: one(purchaseInvoices, {
    fields: [purchaseInvoiceLines.purchaseInvoiceId],
    references: [purchaseInvoices.id],
  }),
  uniqueItem: one(uniqueItems, {
    fields: [purchaseInvoiceLines.uniqueItemId],
    references: [uniqueItems.id],
  }),
  batches: many(purchaseInvoiceLineBatches),
  lots: many(purchaseLots),
}));

export const purchaseInvoiceLineBatchesRelations = relations(purchaseInvoiceLineBatches, ({ one }) => ({
  line: one(purchaseInvoiceLines, {
    fields: [purchaseInvoiceLineBatches.purchaseInvoiceLineId],
    references: [purchaseInvoiceLines.id],
  }),
  batch: one(opticalBatches, {
    fields: [purchaseInvoiceLineBatches.batchId],
    references: [opticalBatches.id],
  }),
}));

export const purchaseLotsRelations = relations(purchaseLots, ({ one }) => ({
  invoice: one(purchaseInvoices, {
    fields: [purchaseLots.purchaseInvoiceId],
    references: [purchaseInvoices.id],
  }),
  line: one(purchaseInvoiceLines, {
    fields: [purchaseLots.purchaseInvoiceLineId],
    references: [purchaseInvoiceLines.id],
  }),
  batch: one(opticalBatches, {
    fields: [purchaseLots.batchId],
    references: [opticalBatches.id],
  }),
  uniqueItem: one(uniqueItems, {
    fields: [purchaseLots.uniqueItemId],
    references: [uniqueItems.id],
  }),
}));

export const supplierLedgersRelations = relations(supplierLedgers, ({ one }) => ({
  party: one(parties, {
    fields: [supplierLedgers.partyId],
    references: [parties.id],
  }),
}));

/**
 * 24. Party Item Prices (Party-wise Last Sale Price)
 * Tracks the most recently posted sale price for each party and unique item combination.
 */
export const partyItemPrices = pgTable('party_item_prices', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id').references(() => businesses.id, { onDelete: 'cascade' }).notNull(),
  partyId: uuid('party_id').references(() => parties.id, { onDelete: 'cascade' }).notNull(),
  uniqueItemId: uuid('unique_item_id').references(() => uniqueItems.id, { onDelete: 'cascade' }).notNull(),
  lastSalePrice: numeric('last_sale_price', { precision: 12, scale: 2 }).notNull(),
  lastSaleAt: timestamp('last_sale_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('party_item_prices_biz_party_item_idx').on(table.businessId, table.partyId, table.uniqueItemId),
  index('party_item_prices_biz_idx').on(table.businessId),
  index('party_item_prices_party_idx').on(table.partyId),
  index('party_item_prices_item_idx').on(table.uniqueItemId),
]);

/**
 * 25. Sales Orders
 * Customer sales booking, draft quoting, and inventory reservation hold.
 */
export const salesOrders = pgTable('sales_orders', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id').references(() => businesses.id, { onDelete: 'cascade' }).notNull(),
  partyId: uuid('party_id').references(() => parties.id, { onDelete: 'restrict' }).notNull(),
  orderNumber: varchar('order_number', { length: 100 }).notNull(), // SO-000001
  orderDate: timestamp('order_date', { withTimezone: true }).defaultNow().notNull(),
  
  // Financial totals
  subtotal: numeric('subtotal', { precision: 12, scale: 2 }).default('0.00').notNull(),
  discountTotal: numeric('discount_total', { precision: 12, scale: 2 }).default('0.00').notNull(),
  taxableAmount: numeric('taxable_amount', { precision: 12, scale: 2 }).default('0.00').notNull(),
  igstRate: numeric('igst_rate', { precision: 5, scale: 2 }).default('0.00').notNull(),
  igstAmount: numeric('igst_amount', { precision: 12, scale: 2 }).default('0.00').notNull(),
  cgstRate: numeric('cgst_rate', { precision: 5, scale: 2 }).default('0.00').notNull(),
  cgstAmount: numeric('cgst_amount', { precision: 12, scale: 2 }).default('0.00').notNull(),
  sgstRate: numeric('sgst_rate', { precision: 5, scale: 2 }).default('0.00').notNull(),
  sgstAmount: numeric('sgst_amount', { precision: 12, scale: 2 }).default('0.00').notNull(),
  roundOff: numeric('round_off', { precision: 12, scale: 2 }).default('0.00').notNull(),
  grandTotal: numeric('grand_total', { precision: 12, scale: 2 }).default('0.00').notNull(),

  status: varchar('status', { length: 50 }).default('DRAFT').notNull(), // DRAFT, CONFIRMED, CANCELLED, CONVERTED, PARTIALLY_CONVERTED
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
}, (table) => [
  uniqueIndex('sales_orders_biz_num_idx').on(table.businessId, table.orderNumber),
  index('sales_orders_biz_idx').on(table.businessId),
  index('sales_orders_party_idx').on(table.partyId),
  index('sales_orders_status_idx').on(table.status),
  index('sales_orders_date_idx').on(table.orderDate),
]);

/**
 * 26. Sales Order Lines
 * Identifies the commercial Unique Item and totals on a Sales Order.
 */
export const salesOrderLines = pgTable('sales_order_lines', {
  id: uuid('id').defaultRandom().primaryKey(),
  salesOrderId: uuid('sales_order_id').references(() => salesOrders.id, { onDelete: 'cascade' }).notNull(),
  uniqueItemId: uuid('unique_item_id').references(() => uniqueItems.id, { onDelete: 'restrict' }).notNull(),
  quantity: numeric('quantity', { precision: 12, scale: 2 }).notNull(), // in pairs
  rate: numeric('rate', { precision: 12, scale: 2 }).notNull(),
  discountType: varchar('discount_type', { length: 20 }).default('NONE').notNull(), // NONE, PERCENTAGE, FIXED
  discountValue: numeric('discount_value', { precision: 12, scale: 2 }).default('0.00').notNull(),
  discountAmount: numeric('discount_amount', { precision: 12, scale: 2 }).default('0.00').notNull(),
  taxableAmount: numeric('taxable_amount', { precision: 12, scale: 2 }).notNull(),
  gstRate: numeric('gst_rate', { precision: 5, scale: 2 }).default('0.00').notNull(),
  taxAmount: numeric('tax_amount', { precision: 12, scale: 2 }).default('0.00').notNull(),
  lineTotal: numeric('line_total', { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('sales_order_lines_order_idx').on(table.salesOrderId),
  index('sales_order_lines_item_idx').on(table.uniqueItemId),
]);

/**
 * 27. Sales Order Line Batches
 * Specific optical batch allocations and quantities reserved for a sales order line.
 */
export const salesOrderLineBatches = pgTable('sales_order_line_batches', {
  id: uuid('id').defaultRandom().primaryKey(),
  salesOrderLineId: uuid('sales_order_line_id').references(() => salesOrderLines.id, { onDelete: 'cascade' }).notNull(),
  batchId: uuid('batch_id').references(() => opticalBatches.id, { onDelete: 'restrict' }).notNull(),
  quantity: numeric('quantity', { precision: 12, scale: 2 }).notNull(), // in pairs
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('sales_order_line_batches_line_idx').on(table.salesOrderLineId),
  index('sales_order_line_batches_batch_idx').on(table.batchId),
]);

/**
 * 28. Sales Invoices
 * Commercial sales tax invoice document.
 */
export const salesInvoices = pgTable('sales_invoices', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id').references(() => businesses.id, { onDelete: 'cascade' }).notNull(),
  partyId: uuid('party_id').references(() => parties.id, { onDelete: 'restrict' }).notNull(),
  salesOrderId: uuid('sales_order_id').references(() => salesOrders.id, { onDelete: 'set null' }),
  invoiceNumber: varchar('invoice_number', { length: 100 }).notNull(), // INV-000001
  invoiceDate: timestamp('invoice_date', { withTimezone: true }).defaultNow().notNull(),
  
  // Financial totals
  subtotal: numeric('subtotal', { precision: 12, scale: 2 }).default('0.00').notNull(),
  discountTotal: numeric('discount_total', { precision: 12, scale: 2 }).default('0.00').notNull(),
  taxableAmount: numeric('taxable_amount', { precision: 12, scale: 2 }).default('0.00').notNull(),
  igstRate: numeric('igst_rate', { precision: 5, scale: 2 }).default('0.00').notNull(),
  igstAmount: numeric('igst_amount', { precision: 12, scale: 2 }).default('0.00').notNull(),
  cgstRate: numeric('cgst_rate', { precision: 5, scale: 2 }).default('0.00').notNull(),
  cgstAmount: numeric('cgst_amount', { precision: 12, scale: 2 }).default('0.00').notNull(),
  sgstRate: numeric('sgst_rate', { precision: 5, scale: 2 }).default('0.00').notNull(),
  sgstAmount: numeric('sgst_amount', { precision: 12, scale: 2 }).default('0.00').notNull(),
  roundOff: numeric('round_off', { precision: 12, scale: 2 }).default('0.00').notNull(),
  grandTotal: numeric('grand_total', { precision: 12, scale: 2 }).default('0.00').notNull(),

  status: varchar('status', { length: 50 }).default('DRAFT').notNull(), // DRAFT, POSTED, CANCELLED
  paymentStatus: varchar('payment_status', { length: 20 }).default('UNPAID').notNull(), // UNPAID, PARTIAL, PAID
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
}, (table) => [
  uniqueIndex('sales_invoices_biz_num_idx').on(table.businessId, table.invoiceNumber),
  index('sales_invoices_biz_idx').on(table.businessId),
  index('sales_invoices_party_idx').on(table.partyId),
  index('sales_invoices_order_idx').on(table.salesOrderId),
  index('sales_invoices_status_idx').on(table.status),
  index('sales_invoices_payment_status_idx').on(table.paymentStatus),
  index('sales_invoices_date_idx').on(table.invoiceDate),
]);

/**
 * 29. Sales Invoice Lines
 * Line items on a Sales Invoice. Duplicate lines are explicitly permitted.
 */
export const salesInvoiceLines = pgTable('sales_invoice_lines', {
  id: uuid('id').defaultRandom().primaryKey(),
  salesInvoiceId: uuid('sales_invoice_id').references(() => salesInvoices.id, { onDelete: 'cascade' }).notNull(),
  uniqueItemId: uuid('unique_item_id').references(() => uniqueItems.id, { onDelete: 'restrict' }).notNull(),
  quantity: numeric('quantity', { precision: 12, scale: 2 }).notNull(), // in pairs
  rate: numeric('rate', { precision: 12, scale: 2 }).notNull(),
  discountType: varchar('discount_type', { length: 20 }).default('NONE').notNull(), // NONE, PERCENTAGE, FIXED
  discountValue: numeric('discount_value', { precision: 12, scale: 2 }).default('0.00').notNull(),
  discountAmount: numeric('discount_amount', { precision: 12, scale: 2 }).default('0.00').notNull(),
  taxableAmount: numeric('taxable_amount', { precision: 12, scale: 2 }).notNull(),
  gstRate: numeric('gst_rate', { precision: 5, scale: 2 }).default('0.00').notNull(),
  taxAmount: numeric('tax_amount', { precision: 12, scale: 2 }).default('0.00').notNull(),
  lineTotal: numeric('line_total', { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('sales_invoice_lines_invoice_idx').on(table.salesInvoiceId),
  index('sales_invoice_lines_item_idx').on(table.uniqueItemId),
]);

/**
 * 30. Sales Invoice Line Batches
 * Maps sold items to exact optical batches for stock deduction and auditability.
 */
export const salesInvoiceLineBatches = pgTable('sales_invoice_line_batches', {
  id: uuid('id').defaultRandom().primaryKey(),
  salesInvoiceLineId: uuid('sales_invoice_line_id').references(() => salesInvoiceLines.id, { onDelete: 'cascade' }).notNull(),
  batchId: uuid('batch_id').references(() => opticalBatches.id, { onDelete: 'restrict' }).notNull(),
  quantity: numeric('quantity', { precision: 12, scale: 2 }).notNull(), // in pairs
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('sales_invoice_line_batches_line_idx').on(table.salesInvoiceLineId),
  index('sales_invoice_line_batches_batch_idx').on(table.batchId),
]);

/**
 * 31. Customer / Sales Ledgers
 * Running balance ledger for optical customers.
 */
export const customerLedgers = pgTable('customer_ledgers', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id').references(() => businesses.id, { onDelete: 'cascade' }).notNull(),
  partyId: uuid('party_id').references(() => parties.id, { onDelete: 'restrict' }).notNull(),
  transactionType: varchar('transaction_type', { length: 50 }).notNull(), // OPENING_BALANCE, SALE, SALES_RETURN, PAYMENT_RECEIVED, DEBIT_NOTE, CREDIT_NOTE, ADJUSTMENT, CANCELLATION_REVERSAL
  referenceType: varchar('reference_type', { length: 50 }), // SALES_INVOICE, PAYMENT_RECEIPT, etc.
  referenceId: varchar('reference_id', { length: 100 }),
  debit: numeric('debit', { precision: 12, scale: 2 }).default('0.00').notNull(),
  credit: numeric('credit', { precision: 12, scale: 2 }).default('0.00').notNull(),
  balance: numeric('balance', { precision: 12, scale: 2 }).notNull(),
  transactionDate: timestamp('transaction_date', { withTimezone: true }).defaultNow().notNull(),
  notes: text('notes'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('customer_ledgers_biz_idx').on(table.businessId),
  index('customer_ledgers_party_idx').on(table.partyId),
  index('customer_ledgers_type_idx').on(table.transactionType),
  index('customer_ledgers_date_idx').on(table.transactionDate),
]);

/**
 * Relations for Phase 4: Sales Orders, Sales Invoices, Party Pricing, Customer Ledgers
 */
export const partyItemPricesRelations = relations(partyItemPrices, ({ one }) => ({
  party: one(parties, {
    fields: [partyItemPrices.partyId],
    references: [parties.id],
  }),
  uniqueItem: one(uniqueItems, {
    fields: [partyItemPrices.uniqueItemId],
    references: [uniqueItems.id],
  }),
}));

export const salesOrdersRelations = relations(salesOrders, ({ one, many }) => ({
  party: one(parties, {
    fields: [salesOrders.partyId],
    references: [parties.id],
  }),
  lines: many(salesOrderLines),
  invoices: many(salesInvoices),
}));

export const salesOrderLinesRelations = relations(salesOrderLines, ({ one, many }) => ({
  order: one(salesOrders, {
    fields: [salesOrderLines.salesOrderId],
    references: [salesOrders.id],
  }),
  uniqueItem: one(uniqueItems, {
    fields: [salesOrderLines.uniqueItemId],
    references: [uniqueItems.id],
  }),
  batches: many(salesOrderLineBatches),
}));

export const salesOrderLineBatchesRelations = relations(salesOrderLineBatches, ({ one }) => ({
  line: one(salesOrderLines, {
    fields: [salesOrderLineBatches.salesOrderLineId],
    references: [salesOrderLines.id],
  }),
  batch: one(opticalBatches, {
    fields: [salesOrderLineBatches.batchId],
    references: [opticalBatches.id],
  }),
}));

export const salesInvoicesRelations = relations(salesInvoices, ({ one, many }) => ({
  party: one(parties, {
    fields: [salesInvoices.partyId],
    references: [parties.id],
  }),
  order: one(salesOrders, {
    fields: [salesInvoices.salesOrderId],
    references: [salesOrders.id],
  }),
  lines: many(salesInvoiceLines),
}));

export const salesInvoiceLinesRelations = relations(salesInvoiceLines, ({ one, many }) => ({
  invoice: one(salesInvoices, {
    fields: [salesInvoiceLines.salesInvoiceId],
    references: [salesInvoices.id],
  }),
  uniqueItem: one(uniqueItems, {
    fields: [salesInvoiceLines.uniqueItemId],
    references: [uniqueItems.id],
  }),
  batches: many(salesInvoiceLineBatches),
}));

export const salesInvoiceLineBatchesRelations = relations(salesInvoiceLineBatches, ({ one }) => ({
  line: one(salesInvoiceLines, {
    fields: [salesInvoiceLineBatches.salesInvoiceLineId],
    references: [salesInvoiceLines.id],
  }),
  batch: one(opticalBatches, {
    fields: [salesInvoiceLineBatches.batchId],
    references: [opticalBatches.id],
  }),
}));

export const customerLedgersRelations = relations(customerLedgers, ({ one }) => ({
  party: one(parties, {
    fields: [customerLedgers.partyId],
    references: [parties.id],
  }),
}));

/**
 * 32. Sales Returns (Credit Notes)
 * Optical customer return document referencing an original sales invoice.
 */
export const salesReturns = pgTable('sales_returns', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id').references(() => businesses.id, { onDelete: 'cascade' }).notNull(),
  salesInvoiceId: uuid('sales_invoice_id').references(() => salesInvoices.id, { onDelete: 'restrict' }).notNull(),
  partyId: uuid('party_id').references(() => parties.id, { onDelete: 'restrict' }).notNull(),
  returnNumber: varchar('return_number', { length: 100 }).notNull(), // SR-000001
  returnDate: timestamp('return_date', { withTimezone: true }).defaultNow().notNull(),

  // Financial totals
  subtotal: numeric('subtotal', { precision: 12, scale: 2 }).default('0.00').notNull(),
  discountTotal: numeric('discount_total', { precision: 12, scale: 2 }).default('0.00').notNull(),
  taxableAmount: numeric('taxable_amount', { precision: 12, scale: 2 }).default('0.00').notNull(),
  igstRate: numeric('igst_rate', { precision: 5, scale: 2 }).default('0.00').notNull(),
  igstAmount: numeric('igst_amount', { precision: 12, scale: 2 }).default('0.00').notNull(),
  cgstRate: numeric('cgst_rate', { precision: 5, scale: 2 }).default('0.00').notNull(),
  cgstAmount: numeric('cgst_amount', { precision: 12, scale: 2 }).default('0.00').notNull(),
  sgstRate: numeric('sgst_rate', { precision: 5, scale: 2 }).default('0.00').notNull(),
  sgstAmount: numeric('sgst_amount', { precision: 12, scale: 2 }).default('0.00').notNull(),
  roundOff: numeric('round_off', { precision: 12, scale: 2 }).default('0.00').notNull(),
  grandTotal: numeric('grand_total', { precision: 12, scale: 2 }).default('0.00').notNull(),

  status: varchar('status', { length: 50 }).default('DRAFT').notNull(), // DRAFT, POSTED, CANCELLED
  reason: text('reason'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
}, (table) => [
  uniqueIndex('sales_returns_biz_num_idx').on(table.businessId, table.returnNumber),
  index('sales_returns_biz_idx').on(table.businessId),
  index('sales_returns_invoice_idx').on(table.salesInvoiceId),
  index('sales_returns_party_idx').on(table.partyId),
  index('sales_returns_status_idx').on(table.status),
  index('sales_returns_date_idx').on(table.returnDate),
]);

/**
 * 33. Sales Return Lines
 * Commercial product rows on a Sales Return.
 */
export const salesReturnLines = pgTable('sales_return_lines', {
  id: uuid('id').defaultRandom().primaryKey(),
  salesReturnId: uuid('sales_return_id').references(() => salesReturns.id, { onDelete: 'cascade' }).notNull(),
  salesInvoiceLineId: uuid('sales_invoice_line_id').references(() => salesInvoiceLines.id, { onDelete: 'restrict' }).notNull(),
  uniqueItemId: uuid('unique_item_id').references(() => uniqueItems.id, { onDelete: 'restrict' }).notNull(),
  quantity: numeric('quantity', { precision: 12, scale: 2 }).notNull(), // in pairs
  rate: numeric('rate', { precision: 12, scale: 2 }).notNull(),
  discountType: varchar('discount_type', { length: 20 }).default('NONE').notNull(),
  discountValue: numeric('discount_value', { precision: 12, scale: 2 }).default('0.00').notNull(),
  discountAmount: numeric('discount_amount', { precision: 12, scale: 2 }).default('0.00').notNull(),
  taxableAmount: numeric('taxable_amount', { precision: 12, scale: 2 }).notNull(),
  gstRate: numeric('gst_rate', { precision: 5, scale: 2 }).default('0.00').notNull(),
  taxAmount: numeric('tax_amount', { precision: 12, scale: 2 }).default('0.00').notNull(),
  lineTotal: numeric('line_total', { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('sales_return_lines_return_idx').on(table.salesReturnId),
  index('sales_return_lines_inv_line_idx').on(table.salesInvoiceLineId),
  index('sales_return_lines_item_idx').on(table.uniqueItemId),
]);

/**
 * 34. Sales Return Line Batches
 * Specific optical power allocations returned to inventory.
 */
export const salesReturnLineBatches = pgTable('sales_return_line_batches', {
  id: uuid('id').defaultRandom().primaryKey(),
  salesReturnLineId: uuid('sales_return_line_id').references(() => salesReturnLines.id, { onDelete: 'cascade' }).notNull(),
  batchId: uuid('batch_id').references(() => opticalBatches.id, { onDelete: 'restrict' }).notNull(),
  quantity: numeric('quantity', { precision: 12, scale: 2 }).notNull(), // in pairs
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('sales_return_line_batches_line_idx').on(table.salesReturnLineId),
  index('sales_return_line_batches_batch_idx').on(table.batchId),
]);

/**
 * 35. Purchase Returns (Debit Notes)
 * Supplier return document referencing an original purchase invoice.
 */
export const purchaseReturns = pgTable('purchase_returns', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id').references(() => businesses.id, { onDelete: 'cascade' }).notNull(),
  purchaseInvoiceId: uuid('purchase_invoice_id').references(() => purchaseInvoices.id, { onDelete: 'restrict' }).notNull(),
  supplierPartyId: uuid('supplier_party_id').references(() => parties.id, { onDelete: 'restrict' }).notNull(),
  returnNumber: varchar('return_number', { length: 100 }).notNull(), // PR-000001
  returnDate: timestamp('return_date', { withTimezone: true }).defaultNow().notNull(),

  // Financial totals
  subtotal: numeric('subtotal', { precision: 12, scale: 2 }).default('0.00').notNull(),
  discountTotal: numeric('discount_total', { precision: 12, scale: 2 }).default('0.00').notNull(),
  taxableAmount: numeric('taxable_amount', { precision: 12, scale: 2 }).default('0.00').notNull(),
  igstRate: numeric('igst_rate', { precision: 5, scale: 2 }).default('0.00').notNull(),
  igstAmount: numeric('igst_amount', { precision: 12, scale: 2 }).default('0.00').notNull(),
  cgstRate: numeric('cgst_rate', { precision: 5, scale: 2 }).default('0.00').notNull(),
  cgstAmount: numeric('cgst_amount', { precision: 12, scale: 2 }).default('0.00').notNull(),
  sgstRate: numeric('sgst_rate', { precision: 5, scale: 2 }).default('0.00').notNull(),
  sgstAmount: numeric('sgst_amount', { precision: 12, scale: 2 }).default('0.00').notNull(),
  roundOff: numeric('round_off', { precision: 12, scale: 2 }).default('0.00').notNull(),
  grandTotal: numeric('grand_total', { precision: 12, scale: 2 }).default('0.00').notNull(),

  status: varchar('status', { length: 50 }).default('DRAFT').notNull(), // DRAFT, POSTED, CANCELLED
  reason: text('reason'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
}, (table) => [
  uniqueIndex('purchase_returns_biz_num_idx').on(table.businessId, table.returnNumber),
  index('purchase_returns_biz_idx').on(table.businessId),
  index('purchase_returns_invoice_idx').on(table.purchaseInvoiceId),
  index('purchase_returns_supplier_idx').on(table.supplierPartyId),
  index('purchase_returns_status_idx').on(table.status),
  index('purchase_returns_date_idx').on(table.returnDate),
]);

/**
 * 36. Purchase Return Lines
 * Line items on a Purchase Return.
 */
export const purchaseReturnLines = pgTable('purchase_return_lines', {
  id: uuid('id').defaultRandom().primaryKey(),
  purchaseReturnId: uuid('purchase_return_id').references(() => purchaseReturns.id, { onDelete: 'cascade' }).notNull(),
  purchaseInvoiceLineId: uuid('purchase_invoice_line_id').references(() => purchaseInvoiceLines.id, { onDelete: 'restrict' }).notNull(),
  uniqueItemId: uuid('unique_item_id').references(() => uniqueItems.id, { onDelete: 'restrict' }).notNull(),
  quantity: numeric('quantity', { precision: 12, scale: 2 }).notNull(), // in pairs
  rate: numeric('rate', { precision: 12, scale: 2 }).notNull(),
  discountType: varchar('discount_type', { length: 20 }).default('NONE').notNull(),
  discountValue: numeric('discount_value', { precision: 12, scale: 2 }).default('0.00').notNull(),
  discountAmount: numeric('discount_amount', { precision: 12, scale: 2 }).default('0.00').notNull(),
  taxableAmount: numeric('taxable_amount', { precision: 12, scale: 2 }).notNull(),
  gstRate: numeric('gst_rate', { precision: 5, scale: 2 }).default('0.00').notNull(),
  taxAmount: numeric('tax_amount', { precision: 12, scale: 2 }).default('0.00').notNull(),
  lineTotal: numeric('line_total', { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('purchase_return_lines_return_idx').on(table.purchaseReturnId),
  index('purchase_return_lines_inv_line_idx').on(table.purchaseInvoiceLineId),
  index('purchase_return_lines_item_idx').on(table.uniqueItemId),
]);

/**
 * 37. Purchase Return Line Batches
 * Specific optical batch and purchase lot references returned to supplier.
 */
export const purchaseReturnLineBatches = pgTable('purchase_return_line_batches', {
  id: uuid('id').defaultRandom().primaryKey(),
  purchaseReturnLineId: uuid('purchase_return_line_id').references(() => purchaseReturnLines.id, { onDelete: 'cascade' }).notNull(),
  batchId: uuid('batch_id').references(() => opticalBatches.id, { onDelete: 'restrict' }).notNull(),
  purchaseLotId: uuid('purchase_lot_id').references(() => purchaseLots.id, { onDelete: 'set null' }),
  quantity: numeric('quantity', { precision: 12, scale: 2 }).notNull(), // in pairs
  rate: numeric('rate', { precision: 12, scale: 2 }).notNull(),
  totalCost: numeric('total_cost', { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('purchase_return_line_batches_line_idx').on(table.purchaseReturnLineId),
  index('purchase_return_line_batches_batch_idx').on(table.batchId),
  index('purchase_return_line_batches_lot_idx').on(table.purchaseLotId),
]);

/**
 * Relations for Phase 5: Sales Returns and Purchase Returns
 */
export const salesReturnsRelations = relations(salesReturns, ({ one, many }) => ({
  party: one(parties, {
    fields: [salesReturns.partyId],
    references: [parties.id],
  }),
  invoice: one(salesInvoices, {
    fields: [salesReturns.salesInvoiceId],
    references: [salesInvoices.id],
  }),
  lines: many(salesReturnLines),
}));

export const salesReturnLinesRelations = relations(salesReturnLines, ({ one, many }) => ({
  salesReturn: one(salesReturns, {
    fields: [salesReturnLines.salesReturnId],
    references: [salesReturns.id],
  }),
  invoiceLine: one(salesInvoiceLines, {
    fields: [salesReturnLines.salesInvoiceLineId],
    references: [salesInvoiceLines.id],
  }),
  uniqueItem: one(uniqueItems, {
    fields: [salesReturnLines.uniqueItemId],
    references: [uniqueItems.id],
  }),
  batches: many(salesReturnLineBatches),
}));

export const salesReturnLineBatchesRelations = relations(salesReturnLineBatches, ({ one }) => ({
  line: one(salesReturnLines, {
    fields: [salesReturnLineBatches.salesReturnLineId],
    references: [salesReturnLines.id],
  }),
  batch: one(opticalBatches, {
    fields: [salesReturnLineBatches.batchId],
    references: [opticalBatches.id],
  }),
}));

export const purchaseReturnsRelations = relations(purchaseReturns, ({ one, many }) => ({
  supplier: one(parties, {
    fields: [purchaseReturns.supplierPartyId],
    references: [parties.id],
  }),
  invoice: one(purchaseInvoices, {
    fields: [purchaseReturns.purchaseInvoiceId],
    references: [purchaseInvoices.id],
  }),
  lines: many(purchaseReturnLines),
}));

export const purchaseReturnLinesRelations = relations(purchaseReturnLines, ({ one, many }) => ({
  purchaseReturn: one(purchaseReturns, {
    fields: [purchaseReturnLines.purchaseReturnId],
    references: [purchaseReturns.id],
  }),
  invoiceLine: one(purchaseInvoiceLines, {
    fields: [purchaseReturnLines.purchaseInvoiceLineId],
    references: [purchaseInvoiceLines.id],
  }),
  uniqueItem: one(uniqueItems, {
    fields: [purchaseReturnLines.uniqueItemId],
    references: [uniqueItems.id],
  }),
  batches: many(purchaseReturnLineBatches),
}));

export const purchaseReturnLineBatchesRelations = relations(purchaseReturnLineBatches, ({ one }) => ({
  line: one(purchaseReturnLines, {
    fields: [purchaseReturnLineBatches.purchaseReturnLineId],
    references: [purchaseReturnLines.id],
  }),
  batch: one(opticalBatches, {
    fields: [purchaseReturnLineBatches.batchId],
    references: [opticalBatches.id],
  }),
  lot: one(purchaseLots, {
    fields: [purchaseReturnLineBatches.purchaseLotId],
    references: [purchaseLots.id],
  }),
}));

/**
 * 39. Payments
 * Commercial payment voucher & customer receipt master.
 */
export const payments = pgTable('payments', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id').references(() => businesses.id, { onDelete: 'cascade' }).notNull(),
  partyId: uuid('party_id').references(() => parties.id, { onDelete: 'restrict' }).notNull(),
  paymentNumber: varchar('payment_number', { length: 100 }).notNull(), // REC-000001, PAY-000001
  paymentDate: timestamp('payment_date', { withTimezone: true }).defaultNow().notNull(),
  paymentType: varchar('payment_type', { length: 20 }).notNull(), // RECEIPT, PAYMENT
  paymentMode: varchar('payment_mode', { length: 50 }).notNull(), // CASH, BANK, UPI, CHEQUE, OTHER
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  unallocatedAmount: numeric('unallocated_amount', { precision: 12, scale: 2 }).default('0.00').notNull(),
  referenceNumber: varchar('100'),
  referenceDate: timestamp('reference_date', { withTimezone: true }),
  bankName: varchar('bank_name', { length: 255 }),
  notes: text('notes'),
  status: varchar('status', { length: 20 }).default('DRAFT').notNull(), // DRAFT, POSTED, CANCELLED
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('payments_biz_number_idx').on(table.businessId, table.paymentNumber),
  index('payments_biz_idx').on(table.businessId),
  index('payments_party_idx').on(table.partyId),
  index('payments_type_idx').on(table.paymentType),
  index('payments_status_idx').on(table.status),
  index('payments_date_idx').on(table.paymentDate),
  index('payments_mode_idx').on(table.paymentMode),
]);

/**
 * 40. Payment Allocations
 * Mapping of payments across specific sales or purchase invoices.
 */
export const paymentAllocations = pgTable('payment_allocations', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id').references(() => businesses.id, { onDelete: 'cascade' }).notNull(),
  paymentId: uuid('payment_id').references(() => payments.id, { onDelete: 'cascade' }).notNull(),
  partyId: uuid('party_id').references(() => parties.id, { onDelete: 'restrict' }).notNull(),
  documentType: varchar('document_type', { length: 50 }).notNull(), // SALES_INVOICE, PURCHASE_INVOICE
  documentId: uuid('document_id').notNull(),
  allocatedAmount: numeric('allocated_amount', { precision: 12, scale: 2 }).notNull(),
  status: varchar('status', { length: 20 }).default('ACTIVE').notNull(), // ACTIVE, CANCELLED
  notes: text('notes'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('payment_allocations_biz_idx').on(table.businessId),
  index('payment_allocations_payment_idx').on(table.paymentId),
  index('payment_allocations_party_idx').on(table.partyId),
  index('payment_allocations_doc_idx').on(table.documentType, table.documentId),
  index('payment_allocations_status_idx').on(table.status),
]);

/**
 * Relations for Phase 6: Payments and Allocations
 */
export const paymentsRelations = relations(payments, ({ one, many }) => ({
  party: one(parties, {
    fields: [payments.partyId],
    references: [parties.id],
  }),
  allocations: many(paymentAllocations),
}));

export const paymentAllocationsRelations = relations(paymentAllocations, ({ one }) => ({
  payment: one(payments, {
    fields: [paymentAllocations.paymentId],
    references: [payments.id],
  }),
  party: one(parties, {
    fields: [paymentAllocations.partyId],
    references: [parties.id],
  }),
}));

/**
 * 41. Import Sessions
 * Manages Excel/CSV bulk data import lifecycle, validation results, preview payload, and posting status.
 */
export const importSessions = pgTable('import_sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id').references(() => businesses.id, { onDelete: 'cascade' }).notNull(),
  importType: varchar('import_type', { length: 50 }).notNull(), // PARTY, PURCHASE, SALES_ORDER, SALES_INVOICE, OPENING_STOCK
  fileName: varchar('file_name', { length: 255 }).notNull(),
  fileSize: numeric('file_size').default('0').notNull(),
  status: varchar('status', { length: 50 }).default('UPLOADED').notNull(), // UPLOADED, VALIDATING, READY, POSTING, COMPLETED, COMPLETED_WITH_ERRORS, FAILED, CANCELLED
  totalRows: numeric('total_rows').default('0').notNull(),
  validRows: numeric('valid_rows').default('0').notNull(),
  invalidRows: numeric('invalid_rows').default('0').notNull(),
  duplicateRows: numeric('duplicate_rows').default('0').notNull(),
  postedRows: numeric('posted_rows').default('0').notNull(),
  failedRows: numeric('failed_rows').default('0').notNull(),
  columnMapping: jsonb('column_mapping'),
  previewData: jsonb('preview_data'),
  errorSummary: jsonb('error_summary'),
  postedDocumentIds: jsonb('posted_document_ids'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (table) => [
  index('import_sessions_biz_idx').on(table.businessId),
  index('import_sessions_type_idx').on(table.importType),
  index('import_sessions_status_idx').on(table.status),
  index('import_sessions_created_at_idx').on(table.createdAt),
]);

export const importSessionsRelations = relations(importSessions, ({ one }) => ({
  business: one(businesses, {
    fields: [importSessions.businessId],
    references: [businesses.id],
  }),
  user: one(users, {
    fields: [importSessions.createdBy],
    references: [users.id],
  }),
}));

/**
 * 42. Business Settings Table
 * Configurable operational business parameters (e.g. low stock alert threshold).
 */
export const businessSettings = pgTable('business_settings', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id').references(() => businesses.id, { onDelete: 'cascade' }).notNull().unique(),
  lowStockThreshold: numeric('low_stock_threshold', { precision: 10, scale: 2 }).default('1.00').notNull(),
  config: jsonb('config').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('business_settings_biz_idx').on(table.businessId),
]);

export const businessSettingsRelations = relations(businessSettings, ({ one }) => ({
  business: one(businesses, {
    fields: [businessSettings.businessId],
    references: [businesses.id],
  }),
}));
