import { pgTable, text, varchar, boolean, timestamp, uuid, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';
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
  fullName: varchar('fullName', { length: 255 }).notNull(),
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
  action: varchar('action', { length: 50 }).notNull(), // view, create, edit, delete, cancel, approve, export, import, adjust_stock, view_purchase_price, edit_sale_price, manage_users, manage_settings
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
