import { pool, db } from './index.js';
import { permissions, roles, rolePermissions } from './schema.js';
import { eq } from 'drizzle-orm';

export const INITIAL_SCHEMA_SQL = `
-- 1. Businesses Table
CREATE TABLE IF NOT EXISTS "businesses" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" VARCHAR(255) NOT NULL,
  "trade_name" VARCHAR(255),
  "gstin" VARCHAR(15),
  "pan" VARCHAR(10),
  "email" VARCHAR(255),
  "phone" VARCHAR(20),
  "address_line1" TEXT,
  "address_line2" TEXT,
  "city" VARCHAR(100),
  "state" VARCHAR(100),
  "state_code" VARCHAR(5),
  "pincode" VARCHAR(10),
  "currency" VARCHAR(10) NOT NULL DEFAULT 'INR',
  "financial_year_start" VARCHAR(10) NOT NULL DEFAULT '04-01',
  "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "created_by" UUID
);

CREATE INDEX IF NOT EXISTS "businesses_status_idx" ON "businesses" ("status");
CREATE INDEX IF NOT EXISTS "businesses_gstin_idx" ON "businesses" ("gstin");

-- 2. Users Table
CREATE TABLE IF NOT EXISTS "users" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "username" VARCHAR(100) NOT NULL UNIQUE,
  "email" VARCHAR(255) UNIQUE,
  "mobile" VARCHAR(20) UNIQUE,
  "full_name" VARCHAR(255) NOT NULL,
  "password_hash" TEXT NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  "is_super_admin" BOOLEAN NOT NULL DEFAULT FALSE,
  "last_login_at" TIMESTAMP WITH TIME ZONE,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "created_by" UUID
);

CREATE INDEX IF NOT EXISTS "users_status_idx" ON "users" ("status");
CREATE INDEX IF NOT EXISTS "users_email_idx" ON "users" ("email");
CREATE INDEX IF NOT EXISTS "users_mobile_idx" ON "users" ("mobile");

-- 3. Roles Table
CREATE TABLE IF NOT EXISTS "roles" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "business_id" UUID REFERENCES "businesses"("id") ON DELETE CASCADE,
  "name" VARCHAR(100) NOT NULL,
  "code" VARCHAR(50) NOT NULL,
  "description" TEXT,
  "is_system" BOOLEAN NOT NULL DEFAULT FALSE,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "roles_business_id_idx" ON "roles" ("business_id");
CREATE INDEX IF NOT EXISTS "roles_code_idx" ON "roles" ("code");

-- 4. Permissions Table
CREATE TABLE IF NOT EXISTS "permissions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "module" VARCHAR(50) NOT NULL,
  "action" VARCHAR(50) NOT NULL,
  "code" VARCHAR(100) NOT NULL UNIQUE,
  "description" TEXT,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "permissions_module_idx" ON "permissions" ("module");

-- 5. Role Permissions Table
CREATE TABLE IF NOT EXISTS "role_permissions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "role_id" UUID NOT NULL REFERENCES "roles"("id") ON DELETE CASCADE,
  "permission_id" UUID NOT NULL REFERENCES "permissions"("id") ON DELETE CASCADE,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "uq_role_permission" UNIQUE ("role_id", "permission_id")
);

CREATE INDEX IF NOT EXISTS "role_permissions_role_id_idx" ON "role_permissions" ("role_id");
CREATE INDEX IF NOT EXISTS "role_permissions_perm_id_idx" ON "role_permissions" ("permission_id");

-- 6. User Business Access Table
CREATE TABLE IF NOT EXISTS "user_business_access" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "business_id" UUID NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "is_default" BOOLEAN NOT NULL DEFAULT FALSE,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "uq_user_business" UNIQUE ("user_id", "business_id")
);

CREATE INDEX IF NOT EXISTS "user_biz_access_user_id_idx" ON "user_business_access" ("user_id");
CREATE INDEX IF NOT EXISTS "user_biz_access_business_id_idx" ON "user_business_access" ("business_id");

-- 7. User Roles Table
CREATE TABLE IF NOT EXISTS "user_roles" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "business_id" UUID NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "role_id" UUID NOT NULL REFERENCES "roles"("id") ON DELETE CASCADE,
  "assigned_by" UUID REFERENCES "users"("id"),
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "uq_user_business_role" UNIQUE ("user_id", "business_id", "role_id")
);

CREATE INDEX IF NOT EXISTS "user_roles_user_id_idx" ON "user_roles" ("user_id");
CREATE INDEX IF NOT EXISTS "user_roles_business_id_idx" ON "user_roles" ("business_id");
CREATE INDEX IF NOT EXISTS "user_roles_role_id_idx" ON "user_roles" ("role_id");

-- 8. Audit Logs Table
CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "business_id" UUID REFERENCES "businesses"("id") ON DELETE SET NULL,
  "user_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "action" VARCHAR(50) NOT NULL,
  "module" VARCHAR(50) NOT NULL,
  "entity_type" VARCHAR(100) NOT NULL,
  "entity_id" VARCHAR(100),
  "previous_value" JSONB,
  "new_value" JSONB,
  "ip_address" VARCHAR(45),
  "user_agent" TEXT,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "audit_logs_business_id_idx" ON "audit_logs" ("business_id");
CREATE INDEX IF NOT EXISTS "audit_logs_user_id_idx" ON "audit_logs" ("user_id");
CREATE INDEX IF NOT EXISTS "audit_logs_created_at_idx" ON "audit_logs" ("created_at");
CREATE INDEX IF NOT EXISTS "audit_logs_module_idx" ON "audit_logs" ("module");
CREATE INDEX IF NOT EXISTS "audit_logs_action_idx" ON "audit_logs" ("action");

-- 9. Categories Master Table
CREATE TABLE IF NOT EXISTS "categories" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "business_id" UUID REFERENCES "businesses"("id") ON DELETE CASCADE,
  "name" VARCHAR(100) NOT NULL,
  "code" VARCHAR(50) NOT NULL,
  "description" TEXT,
  "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "created_by" UUID,
  "updated_by" UUID
);

CREATE INDEX IF NOT EXISTS "categories_business_id_idx" ON "categories" ("business_id");
CREATE INDEX IF NOT EXISTS "categories_status_idx" ON "categories" ("status");
CREATE INDEX IF NOT EXISTS "categories_code_idx" ON "categories" ("code");
CREATE UNIQUE INDEX IF NOT EXISTS "categories_biz_code_idx" ON "categories" ("business_id", "code");

-- 10. Coatings Master Table
CREATE TABLE IF NOT EXISTS "coatings" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "business_id" UUID REFERENCES "businesses"("id") ON DELETE CASCADE,
  "name" VARCHAR(100) NOT NULL,
  "code" VARCHAR(50) NOT NULL,
  "description" TEXT,
  "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "created_by" UUID,
  "updated_by" UUID
);

CREATE INDEX IF NOT EXISTS "coatings_business_id_idx" ON "coatings" ("business_id");
CREATE INDEX IF NOT EXISTS "coatings_status_idx" ON "coatings" ("status");
CREATE INDEX IF NOT EXISTS "coatings_code_idx" ON "coatings" ("code");
CREATE UNIQUE INDEX IF NOT EXISTS "coatings_biz_code_idx" ON "coatings" ("business_id", "code");

-- 11. Bases Master Table
CREATE TABLE IF NOT EXISTS "bases" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "business_id" UUID REFERENCES "businesses"("id") ON DELETE CASCADE,
  "name" VARCHAR(100) NOT NULL,
  "code" VARCHAR(50) NOT NULL,
  "family" VARCHAR(100),
  "coating_id" UUID REFERENCES "coatings"("id") ON DELETE SET NULL,
  "description" TEXT,
  "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "created_by" UUID,
  "updated_by" UUID
);

CREATE INDEX IF NOT EXISTS "bases_business_id_idx" ON "bases" ("business_id");
CREATE INDEX IF NOT EXISTS "bases_status_idx" ON "bases" ("status");
CREATE INDEX IF NOT EXISTS "bases_code_idx" ON "bases" ("code");
CREATE INDEX IF NOT EXISTS "bases_coating_id_idx" ON "bases" ("coating_id");
CREATE UNIQUE INDEX IF NOT EXISTS "bases_biz_code_idx" ON "bases" ("business_id", "code");

-- 12. Base Categories Compatibility Table
CREATE TABLE IF NOT EXISTS "base_categories" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "business_id" UUID REFERENCES "businesses"("id") ON DELETE CASCADE,
  "base_id" UUID NOT NULL REFERENCES "bases"("id") ON DELETE CASCADE,
  "category_id" UUID NOT NULL REFERENCES "categories"("id") ON DELETE CASCADE,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "base_categories_base_id_idx" ON "base_categories" ("base_id");
CREATE INDEX IF NOT EXISTS "base_categories_cat_id_idx" ON "base_categories" ("category_id");
CREATE INDEX IF NOT EXISTS "base_categories_biz_id_idx" ON "base_categories" ("business_id");
CREATE UNIQUE INDEX IF NOT EXISTS "base_cat_biz_base_cat_idx" ON "base_categories" ("business_id", "base_id", "category_id");

-- 13. Primary Items Table
CREATE TABLE IF NOT EXISTS "primary_items" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "category_id" UUID NOT NULL REFERENCES "categories"("id") ON DELETE RESTRICT,
  "base_id" UUID NOT NULL REFERENCES "bases"("id") ON DELETE RESTRICT,
  "coating_id" UUID REFERENCES "coatings"("id") ON DELETE SET NULL,
  "name" VARCHAR(255) NOT NULL,
  "code" VARCHAR(100) NOT NULL,
  "description" TEXT,
  "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "created_by" UUID,
  "updated_by" UUID
);

CREATE INDEX IF NOT EXISTS "primary_items_biz_idx" ON "primary_items" ("business_id");
CREATE INDEX IF NOT EXISTS "primary_items_cat_idx" ON "primary_items" ("category_id");
CREATE INDEX IF NOT EXISTS "primary_items_base_idx" ON "primary_items" ("base_id");
CREATE INDEX IF NOT EXISTS "primary_items_coating_idx" ON "primary_items" ("coating_id");
CREATE INDEX IF NOT EXISTS "primary_items_status_idx" ON "primary_items" ("status");
CREATE UNIQUE INDEX IF NOT EXISTS "primary_items_biz_code_idx" ON "primary_items" ("business_id", "code");

-- 14. Unique Items Table
CREATE TABLE IF NOT EXISTS "unique_items" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "primary_item_id" UUID NOT NULL REFERENCES "primary_items"("id") ON DELETE CASCADE,
  "name" VARCHAR(255) NOT NULL,
  "code" VARCHAR(100) NOT NULL,
  "description" TEXT,
  "purchase_rate" NUMERIC(12, 2) DEFAULT 0.00,
  "last_purchase_price" NUMERIC(12, 2) DEFAULT 0.00,
  "mrp" NUMERIC(12, 2) DEFAULT 0.00,
  "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "created_by" UUID,
  "updated_by" UUID
);

CREATE INDEX IF NOT EXISTS "unique_items_biz_idx" ON "unique_items" ("business_id");
CREATE INDEX IF NOT EXISTS "unique_items_primary_idx" ON "unique_items" ("primary_item_id");
CREATE INDEX IF NOT EXISTS "unique_items_status_idx" ON "unique_items" ("status");
CREATE UNIQUE INDEX IF NOT EXISTS "unique_items_biz_code_idx" ON "unique_items" ("business_id", "code");

-- 15. Optical Batches Table
CREATE TABLE IF NOT EXISTS "optical_batches" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "unique_item_id" UUID NOT NULL REFERENCES "unique_items"("id") ON DELETE CASCADE,
  "category_id" UUID NOT NULL REFERENCES "categories"("id") ON DELETE RESTRICT,
  "barcode" VARCHAR(100) NOT NULL,
  "sph" NUMERIC(6, 2) NOT NULL,
  "cyl" NUMERIC(6, 2) NOT NULL,
  "axis" NUMERIC(5, 1) NOT NULL DEFAULT 0.0,
  "add" NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
  "side" VARCHAR(10) NOT NULL DEFAULT 'NONE',
  "identity_key" VARCHAR(255) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "created_by" UUID,
  "updated_by" UUID
);

CREATE UNIQUE INDEX IF NOT EXISTS "optical_batches_barcode_idx" ON "optical_batches" ("barcode");
CREATE UNIQUE INDEX IF NOT EXISTS "optical_batches_biz_identity_idx" ON "optical_batches" ("business_id", "identity_key");
CREATE INDEX IF NOT EXISTS "optical_batches_biz_idx" ON "optical_batches" ("business_id");
CREATE INDEX IF NOT EXISTS "optical_batches_unique_item_idx" ON "optical_batches" ("unique_item_id");
CREATE INDEX IF NOT EXISTS "optical_batches_category_idx" ON "optical_batches" ("category_id");
CREATE INDEX IF NOT EXISTS "optical_batches_status_idx" ON "optical_batches" ("status");
CREATE INDEX IF NOT EXISTS "optical_batches_powers_idx" ON "optical_batches" ("sph", "cyl", "axis", "add", "side");

-- 16. Optical Stocks Table
CREATE TABLE IF NOT EXISTS "optical_stocks" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "batch_id" UUID NOT NULL REFERENCES "optical_batches"("id") ON DELETE CASCADE,
  "physical_stock" NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  "reserved_stock" NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  "available_stock" NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "optical_stocks_biz_batch_idx" ON "optical_stocks" ("business_id", "batch_id");
CREATE INDEX IF NOT EXISTS "optical_stocks_biz_idx" ON "optical_stocks" ("business_id");
CREATE INDEX IF NOT EXISTS "optical_stocks_batch_idx" ON "optical_stocks" ("batch_id");

-- 17. Stock Ledger Table
CREATE TABLE IF NOT EXISTS "stock_ledger" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "batch_id" UUID NOT NULL REFERENCES "optical_batches"("id") ON DELETE CASCADE,
  "transaction_type" VARCHAR(50) NOT NULL,
  "reference_type" VARCHAR(50),
  "reference_id" VARCHAR(100),
  "quantity_in" NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  "quantity_out" NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  "reserved_in" NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  "reserved_out" NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  "balance" NUMERIC(12, 2) NOT NULL,
  "reason" TEXT,
  "created_by" UUID,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "stock_ledger_biz_idx" ON "stock_ledger" ("business_id");
CREATE INDEX IF NOT EXISTS "stock_ledger_batch_idx" ON "stock_ledger" ("batch_id");
CREATE INDEX IF NOT EXISTS "stock_ledger_type_idx" ON "stock_ledger" ("transaction_type");
CREATE INDEX IF NOT EXISTS "stock_ledger_created_at_idx" ON "stock_ledger" ("created_at");

-- 18. Parties Table
CREATE TABLE IF NOT EXISTS "parties" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "party_code" VARCHAR(50) NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "display_name" VARCHAR(255),
  "party_type" VARCHAR(20) NOT NULL,
  "mobile" VARCHAR(20),
  "alternate_mobile" VARCHAR(20),
  "email" VARCHAR(255),
  "address_line_1" TEXT,
  "address_line_2" TEXT,
  "city" VARCHAR(100),
  "state" VARCHAR(100),
  "pincode" VARCHAR(10),
  "country" VARCHAR(100) DEFAULT 'India',
  "gstin" VARCHAR(15),
  "pan" VARCHAR(10),
  "credit_limit" NUMERIC(12, 2) DEFAULT 0.00,
  "credit_days" VARCHAR(10) DEFAULT '0',
  "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  "notes" TEXT,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "created_by" UUID,
  "updated_by" UUID
);

CREATE UNIQUE INDEX IF NOT EXISTS "parties_biz_code_idx" ON "parties" ("business_id", "party_code");
CREATE INDEX IF NOT EXISTS "parties_biz_idx" ON "parties" ("business_id");
CREATE INDEX IF NOT EXISTS "parties_type_idx" ON "parties" ("party_type");
CREATE INDEX IF NOT EXISTS "parties_status_idx" ON "parties" ("status");
CREATE INDEX IF NOT EXISTS "parties_mobile_idx" ON "parties" ("mobile");
CREATE INDEX IF NOT EXISTS "parties_gstin_idx" ON "parties" ("gstin");

-- 19. Purchase Invoices Table
CREATE TABLE IF NOT EXISTS "purchase_invoices" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "supplier_party_id" UUID NOT NULL REFERENCES "parties"("id") ON DELETE RESTRICT,
  "invoice_number" VARCHAR(50) NOT NULL,
  "invoice_date" TIMESTAMP WITH TIME ZONE NOT NULL,
  "supplier_invoice_number" VARCHAR(100),
  "supplier_invoice_date" TIMESTAMP WITH TIME ZONE,
  "gst_mode" VARCHAR(20) NOT NULL DEFAULT 'INTRA_STATE',
  "subtotal" NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  "discount_total" NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  "taxable_amount" NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  "igst_rate" NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
  "igst_amount" NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  "cgst_rate" NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
  "cgst_amount" NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  "sgst_rate" NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
  "sgst_amount" NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  "round_off" NUMERIC(8, 2) NOT NULL DEFAULT 0.00,
  "grand_total" NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  "payment_status" VARCHAR(20) NOT NULL DEFAULT 'UNPAID',
  "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  "notes" TEXT,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "created_by" UUID,
  "updated_by" UUID
);

CREATE UNIQUE INDEX IF NOT EXISTS "purchase_invoices_biz_num_idx" ON "purchase_invoices" ("business_id", "invoice_number");
CREATE INDEX IF NOT EXISTS "purchase_invoices_biz_idx" ON "purchase_invoices" ("business_id");
CREATE INDEX IF NOT EXISTS "purchase_invoices_supplier_idx" ON "purchase_invoices" ("supplier_party_id");
CREATE INDEX IF NOT EXISTS "purchase_invoices_date_idx" ON "purchase_invoices" ("invoice_date");
CREATE INDEX IF NOT EXISTS "purchase_invoices_status_idx" ON "purchase_invoices" ("status");

-- 20. Purchase Invoice Lines Table
CREATE TABLE IF NOT EXISTS "purchase_invoice_lines" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "purchase_invoice_id" UUID NOT NULL REFERENCES "purchase_invoices"("id") ON DELETE CASCADE,
  "unique_item_id" UUID NOT NULL REFERENCES "unique_items"("id") ON DELETE RESTRICT,
  "quantity" NUMERIC(12, 2) NOT NULL,
  "rate" NUMERIC(12, 2) NOT NULL,
  "discount_type" VARCHAR(20) NOT NULL DEFAULT 'NONE',
  "discount_value" NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  "discount_amount" NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  "taxable_amount" NUMERIC(12, 2) NOT NULL,
  "gst_rate" NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
  "tax_amount" NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  "line_total" NUMERIC(12, 2) NOT NULL,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "purchase_lines_invoice_idx" ON "purchase_invoice_lines" ("purchase_invoice_id");
CREATE INDEX IF NOT EXISTS "purchase_lines_item_idx" ON "purchase_invoice_lines" ("unique_item_id");

-- 21. Purchase Invoice Line Batches Table
CREATE TABLE IF NOT EXISTS "purchase_invoice_line_batches" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "purchase_invoice_line_id" UUID NOT NULL REFERENCES "purchase_invoice_lines"("id") ON DELETE CASCADE,
  "batch_id" UUID NOT NULL REFERENCES "optical_batches"("id") ON DELETE RESTRICT,
  "quantity" NUMERIC(12, 2) NOT NULL,
  "rate" NUMERIC(12, 2) NOT NULL,
  "total_cost" NUMERIC(12, 2) NOT NULL,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "purchase_line_batches_line_idx" ON "purchase_invoice_line_batches" ("purchase_invoice_line_id");
CREATE INDEX IF NOT EXISTS "purchase_line_batches_batch_idx" ON "purchase_invoice_line_batches" ("batch_id");

-- 22. Purchase Lots Table
CREATE TABLE IF NOT EXISTS "purchase_lots" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "purchase_invoice_id" UUID NOT NULL REFERENCES "purchase_invoices"("id") ON DELETE CASCADE,
  "purchase_invoice_line_id" UUID NOT NULL REFERENCES "purchase_invoice_lines"("id") ON DELETE CASCADE,
  "batch_id" UUID NOT NULL REFERENCES "optical_batches"("id") ON DELETE RESTRICT,
  "unique_item_id" UUID NOT NULL REFERENCES "unique_items"("id") ON DELETE RESTRICT,
  "quantity_received" NUMERIC(12, 2) NOT NULL,
  "rate" NUMERIC(12, 2) NOT NULL,
  "tax_rate" NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
  "received_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "remaining_quantity" NUMERIC(12, 2) NOT NULL,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "purchase_lots_biz_idx" ON "purchase_lots" ("business_id");
CREATE INDEX IF NOT EXISTS "purchase_lots_invoice_idx" ON "purchase_lots" ("purchase_invoice_id");
CREATE INDEX IF NOT EXISTS "purchase_lots_item_idx" ON "purchase_lots" ("unique_item_id");
CREATE INDEX IF NOT EXISTS "purchase_lots_batch_idx" ON "purchase_lots" ("batch_id");

-- 23. Supplier Ledgers Table
CREATE TABLE IF NOT EXISTS "supplier_ledgers" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "party_id" UUID NOT NULL REFERENCES "parties"("id") ON DELETE RESTRICT,
  "transaction_type" VARCHAR(50) NOT NULL,
  "reference_type" VARCHAR(50),
  "reference_id" VARCHAR(100),
  "debit" NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  "credit" NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  "balance" NUMERIC(12, 2) NOT NULL,
  "transaction_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "notes" TEXT,
  "created_by" UUID,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "supplier_ledgers_biz_idx" ON "supplier_ledgers" ("business_id");
CREATE INDEX IF NOT EXISTS "supplier_ledgers_party_idx" ON "supplier_ledgers" ("party_id");
CREATE INDEX IF NOT EXISTS "supplier_ledgers_type_idx" ON "supplier_ledgers" ("transaction_type");
CREATE INDEX IF NOT EXISTS "supplier_ledgers_date_idx" ON "supplier_ledgers" ("transaction_date");

-- 24. Stock Reservations Table
CREATE TABLE IF NOT EXISTS "stock_reservations" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "batch_id" UUID NOT NULL REFERENCES "optical_batches"("id") ON DELETE CASCADE,
  "quantity" NUMERIC(12, 2) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  "reference_type" VARCHAR(50) NOT NULL DEFAULT 'MANUAL_HOLD',
  "reference_id" VARCHAR(100),
  "notes" TEXT,
  "created_by" UUID,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "released_at" TIMESTAMP WITH TIME ZONE,
  "converted_at" TIMESTAMP WITH TIME ZONE,
  "cancelled_at" TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS "stock_reservations_biz_idx" ON "stock_reservations" ("business_id");
CREATE INDEX IF NOT EXISTS "stock_reservations_batch_idx" ON "stock_reservations" ("batch_id");
CREATE INDEX IF NOT EXISTS "stock_reservations_status_idx" ON "stock_reservations" ("status");
CREATE INDEX IF NOT EXISTS "stock_reservations_created_at_idx" ON "stock_reservations" ("created_at");

-- 25. Party Item Prices Table (Party-wise Last Sale Price)
CREATE TABLE IF NOT EXISTS "party_item_prices" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "party_id" UUID NOT NULL REFERENCES "parties"("id") ON DELETE CASCADE,
  "unique_item_id" UUID NOT NULL REFERENCES "unique_items"("id") ON DELETE CASCADE,
  "last_sale_price" NUMERIC(12, 2) NOT NULL,
  "last_sale_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "uq_party_item_price" UNIQUE ("business_id", "party_id", "unique_item_id")
);

CREATE INDEX IF NOT EXISTS "party_item_prices_biz_idx" ON "party_item_prices" ("business_id");
CREATE INDEX IF NOT EXISTS "party_item_prices_party_idx" ON "party_item_prices" ("party_id");
CREATE INDEX IF NOT EXISTS "party_item_prices_item_idx" ON "party_item_prices" ("unique_item_id");

-- 26. Sales Orders Table
CREATE TABLE IF NOT EXISTS "sales_orders" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "party_id" UUID NOT NULL REFERENCES "parties"("id") ON DELETE RESTRICT,
  "order_number" VARCHAR(100) NOT NULL,
  "order_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "subtotal" NUMERIC(12, 2) NOT NULL DEFAULT '0.00',
  "discount_total" NUMERIC(12, 2) NOT NULL DEFAULT '0.00',
  "taxable_amount" NUMERIC(12, 2) NOT NULL DEFAULT '0.00',
  "igst_rate" NUMERIC(5, 2) NOT NULL DEFAULT '0.00',
  "igst_amount" NUMERIC(12, 2) NOT NULL DEFAULT '0.00',
  "cgst_rate" NUMERIC(5, 2) NOT NULL DEFAULT '0.00',
  "cgst_amount" NUMERIC(12, 2) NOT NULL DEFAULT '0.00',
  "sgst_rate" NUMERIC(5, 2) NOT NULL DEFAULT '0.00',
  "sgst_amount" NUMERIC(12, 2) NOT NULL DEFAULT '0.00',
  "round_off" NUMERIC(12, 2) NOT NULL DEFAULT '0.00',
  "grand_total" NUMERIC(12, 2) NOT NULL DEFAULT '0.00',
  "status" VARCHAR(50) NOT NULL DEFAULT 'DRAFT',
  "notes" TEXT,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "created_by" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "uq_sales_order_number" UNIQUE ("business_id", "order_number")
);

CREATE INDEX IF NOT EXISTS "sales_orders_biz_idx" ON "sales_orders" ("business_id");
CREATE INDEX IF NOT EXISTS "sales_orders_party_idx" ON "sales_orders" ("party_id");
CREATE INDEX IF NOT EXISTS "sales_orders_status_idx" ON "sales_orders" ("status");
CREATE INDEX IF NOT EXISTS "sales_orders_date_idx" ON "sales_orders" ("order_date");

-- 27. Sales Order Lines Table
CREATE TABLE IF NOT EXISTS "sales_order_lines" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "sales_order_id" UUID NOT NULL REFERENCES "sales_orders"("id") ON DELETE CASCADE,
  "unique_item_id" UUID NOT NULL REFERENCES "unique_items"("id") ON DELETE RESTRICT,
  "quantity" NUMERIC(12, 2) NOT NULL,
  "rate" NUMERIC(12, 2) NOT NULL,
  "discount_type" VARCHAR(20) NOT NULL DEFAULT 'NONE',
  "discount_value" NUMERIC(12, 2) NOT NULL DEFAULT '0.00',
  "discount_amount" NUMERIC(12, 2) NOT NULL DEFAULT '0.00',
  "taxable_amount" NUMERIC(12, 2) NOT NULL,
  "gst_rate" NUMERIC(5, 2) NOT NULL DEFAULT '0.00',
  "tax_amount" NUMERIC(12, 2) NOT NULL DEFAULT '0.00',
  "line_total" NUMERIC(12, 2) NOT NULL,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "sales_order_lines_order_idx" ON "sales_order_lines" ("sales_order_id");
CREATE INDEX IF NOT EXISTS "sales_order_lines_item_idx" ON "sales_order_lines" ("unique_item_id");

-- 28. Sales Order Line Batches Table
CREATE TABLE IF NOT EXISTS "sales_order_line_batches" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "sales_order_line_id" UUID NOT NULL REFERENCES "sales_order_lines"("id") ON DELETE CASCADE,
  "batch_id" UUID NOT NULL REFERENCES "optical_batches"("id") ON DELETE RESTRICT,
  "quantity" NUMERIC(12, 2) NOT NULL,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "sales_order_line_batches_line_idx" ON "sales_order_line_batches" ("sales_order_line_id");
CREATE INDEX IF NOT EXISTS "sales_order_line_batches_batch_idx" ON "sales_order_line_batches" ("batch_id");

-- 29. Sales Invoices Table
CREATE TABLE IF NOT EXISTS "sales_invoices" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "party_id" UUID NOT NULL REFERENCES "parties"("id") ON DELETE RESTRICT,
  "sales_order_id" UUID REFERENCES "sales_orders"("id") ON DELETE SET NULL,
  "invoice_number" VARCHAR(100) NOT NULL,
  "invoice_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "subtotal" NUMERIC(12, 2) NOT NULL DEFAULT '0.00',
  "discount_total" NUMERIC(12, 2) NOT NULL DEFAULT '0.00',
  "taxable_amount" NUMERIC(12, 2) NOT NULL DEFAULT '0.00',
  "igst_rate" NUMERIC(5, 2) NOT NULL DEFAULT '0.00',
  "igst_amount" NUMERIC(12, 2) NOT NULL DEFAULT '0.00',
  "cgst_rate" NUMERIC(5, 2) NOT NULL DEFAULT '0.00',
  "cgst_amount" NUMERIC(12, 2) NOT NULL DEFAULT '0.00',
  "sgst_rate" NUMERIC(5, 2) NOT NULL DEFAULT '0.00',
  "sgst_amount" NUMERIC(12, 2) NOT NULL DEFAULT '0.00',
  "round_off" NUMERIC(12, 2) NOT NULL DEFAULT '0.00',
  "grand_total" NUMERIC(12, 2) NOT NULL DEFAULT '0.00',
  "status" VARCHAR(50) NOT NULL DEFAULT 'DRAFT',
  "notes" TEXT,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "created_by" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "uq_sales_invoice_number" UNIQUE ("business_id", "invoice_number")
);

CREATE INDEX IF NOT EXISTS "sales_invoices_biz_idx" ON "sales_invoices" ("business_id");
CREATE INDEX IF NOT EXISTS "sales_invoices_party_idx" ON "sales_invoices" ("party_id");
CREATE INDEX IF NOT EXISTS "sales_invoices_order_idx" ON "sales_invoices" ("sales_order_id");
CREATE INDEX IF NOT EXISTS "sales_invoices_status_idx" ON "sales_invoices" ("status");
CREATE INDEX IF NOT EXISTS "sales_invoices_date_idx" ON "sales_invoices" ("invoice_date");

-- 30. Sales Invoice Lines Table
CREATE TABLE IF NOT EXISTS "sales_invoice_lines" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "sales_invoice_id" UUID NOT NULL REFERENCES "sales_invoices"("id") ON DELETE CASCADE,
  "unique_item_id" UUID NOT NULL REFERENCES "unique_items"("id") ON DELETE RESTRICT,
  "quantity" NUMERIC(12, 2) NOT NULL,
  "rate" NUMERIC(12, 2) NOT NULL,
  "discount_type" VARCHAR(20) NOT NULL DEFAULT 'NONE',
  "discount_value" NUMERIC(12, 2) NOT NULL DEFAULT '0.00',
  "discount_amount" NUMERIC(12, 2) NOT NULL DEFAULT '0.00',
  "taxable_amount" NUMERIC(12, 2) NOT NULL,
  "gst_rate" NUMERIC(5, 2) NOT NULL DEFAULT '0.00',
  "tax_amount" NUMERIC(12, 2) NOT NULL DEFAULT '0.00',
  "line_total" NUMERIC(12, 2) NOT NULL,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "sales_invoice_lines_invoice_idx" ON "sales_invoice_lines" ("sales_invoice_id");
CREATE INDEX IF NOT EXISTS "sales_invoice_lines_item_idx" ON "sales_invoice_lines" ("unique_item_id");

-- 31. Sales Invoice Line Batches Table
CREATE TABLE IF NOT EXISTS "sales_invoice_line_batches" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "sales_invoice_line_id" UUID NOT NULL REFERENCES "sales_invoice_lines"("id") ON DELETE CASCADE,
  "batch_id" UUID NOT NULL REFERENCES "optical_batches"("id") ON DELETE RESTRICT,
  "quantity" NUMERIC(12, 2) NOT NULL,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "sales_invoice_line_batches_line_idx" ON "sales_invoice_line_batches" ("sales_invoice_line_id");
CREATE INDEX IF NOT EXISTS "sales_invoice_line_batches_batch_idx" ON "sales_invoice_line_batches" ("batch_id");

-- 32. Customer / Sales Ledgers Table
CREATE TABLE IF NOT EXISTS "customer_ledgers" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "party_id" UUID NOT NULL REFERENCES "parties"("id") ON DELETE RESTRICT,
  "transaction_type" VARCHAR(50) NOT NULL,
  "reference_type" VARCHAR(50),
  "reference_id" VARCHAR(100),
  "debit" NUMERIC(12, 2) NOT NULL DEFAULT '0.00',
  "credit" NUMERIC(12, 2) NOT NULL DEFAULT '0.00',
  "balance" NUMERIC(12, 2) NOT NULL,
  "transaction_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "notes" TEXT,
  "created_by" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "customer_ledgers_biz_idx" ON "customer_ledgers" ("business_id");
CREATE INDEX IF NOT EXISTS "customer_ledgers_party_idx" ON "customer_ledgers" ("party_id");
CREATE INDEX IF NOT EXISTS "customer_ledgers_type_idx" ON "customer_ledgers" ("transaction_type");
CREATE INDEX IF NOT EXISTS "customer_ledgers_date_idx" ON "customer_ledgers" ("transaction_date");

-- 33. Sales Returns Table (Credit Notes)
CREATE TABLE IF NOT EXISTS "sales_returns" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "sales_invoice_id" UUID NOT NULL REFERENCES "sales_invoices"("id") ON DELETE RESTRICT,
  "party_id" UUID NOT NULL REFERENCES "parties"("id") ON DELETE RESTRICT,
  "return_number" VARCHAR(100) NOT NULL,
  "return_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "subtotal" NUMERIC(12, 2) NOT NULL DEFAULT '0.00',
  "discount_total" NUMERIC(12, 2) NOT NULL DEFAULT '0.00',
  "taxable_amount" NUMERIC(12, 2) NOT NULL DEFAULT '0.00',
  "igst_rate" NUMERIC(5, 2) NOT NULL DEFAULT '0.00',
  "igst_amount" NUMERIC(12, 2) NOT NULL DEFAULT '0.00',
  "cgst_rate" NUMERIC(5, 2) NOT NULL DEFAULT '0.00',
  "cgst_amount" NUMERIC(12, 2) NOT NULL DEFAULT '0.00',
  "sgst_rate" NUMERIC(5, 2) NOT NULL DEFAULT '0.00',
  "sgst_amount" NUMERIC(12, 2) NOT NULL DEFAULT '0.00',
  "round_off" NUMERIC(12, 2) NOT NULL DEFAULT '0.00',
  "grand_total" NUMERIC(12, 2) NOT NULL DEFAULT '0.00',
  "status" VARCHAR(50) NOT NULL DEFAULT 'DRAFT',
  "reason" TEXT,
  "notes" TEXT,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "created_by" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "uq_sales_return_number" UNIQUE ("business_id", "return_number")
);

CREATE INDEX IF NOT EXISTS "sales_returns_biz_idx" ON "sales_returns" ("business_id");
CREATE INDEX IF NOT EXISTS "sales_returns_invoice_idx" ON "sales_returns" ("sales_invoice_id");
CREATE INDEX IF NOT EXISTS "sales_returns_party_idx" ON "sales_returns" ("party_id");
CREATE INDEX IF NOT EXISTS "sales_returns_status_idx" ON "sales_returns" ("status");
CREATE INDEX IF NOT EXISTS "sales_returns_date_idx" ON "sales_returns" ("return_date");

-- 34. Sales Return Lines Table
CREATE TABLE IF NOT EXISTS "sales_return_lines" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "sales_return_id" UUID NOT NULL REFERENCES "sales_returns"("id") ON DELETE CASCADE,
  "sales_invoice_line_id" UUID NOT NULL REFERENCES "sales_invoice_lines"("id") ON DELETE RESTRICT,
  "unique_item_id" UUID NOT NULL REFERENCES "unique_items"("id") ON DELETE RESTRICT,
  "quantity" NUMERIC(12, 2) NOT NULL,
  "rate" NUMERIC(12, 2) NOT NULL,
  "discount_type" VARCHAR(20) NOT NULL DEFAULT 'NONE',
  "discount_value" NUMERIC(12, 2) NOT NULL DEFAULT '0.00',
  "discount_amount" NUMERIC(12, 2) NOT NULL DEFAULT '0.00',
  "taxable_amount" NUMERIC(12, 2) NOT NULL,
  "gst_rate" NUMERIC(5, 2) NOT NULL DEFAULT '0.00',
  "tax_amount" NUMERIC(12, 2) NOT NULL DEFAULT '0.00',
  "line_total" NUMERIC(12, 2) NOT NULL,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "sales_return_lines_return_idx" ON "sales_return_lines" ("sales_return_id");
CREATE INDEX IF NOT EXISTS "sales_return_lines_inv_line_idx" ON "sales_return_lines" ("sales_invoice_line_id");
CREATE INDEX IF NOT EXISTS "sales_return_lines_item_idx" ON "sales_return_lines" ("unique_item_id");

-- 35. Sales Return Line Batches Table
CREATE TABLE IF NOT EXISTS "sales_return_line_batches" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "sales_return_line_id" UUID NOT NULL REFERENCES "sales_return_lines"("id") ON DELETE CASCADE,
  "batch_id" UUID NOT NULL REFERENCES "optical_batches"("id") ON DELETE RESTRICT,
  "quantity" NUMERIC(12, 2) NOT NULL,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "sales_return_line_batches_line_idx" ON "sales_return_line_batches" ("sales_return_line_id");
CREATE INDEX IF NOT EXISTS "sales_return_line_batches_batch_idx" ON "sales_return_line_batches" ("batch_id");

-- 36. Purchase Returns Table (Debit Notes)
CREATE TABLE IF NOT EXISTS "purchase_returns" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "purchase_invoice_id" UUID NOT NULL REFERENCES "purchase_invoices"("id") ON DELETE RESTRICT,
  "supplier_party_id" UUID NOT NULL REFERENCES "parties"("id") ON DELETE RESTRICT,
  "return_number" VARCHAR(100) NOT NULL,
  "return_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "subtotal" NUMERIC(12, 2) NOT NULL DEFAULT '0.00',
  "discount_total" NUMERIC(12, 2) NOT NULL DEFAULT '0.00',
  "taxable_amount" NUMERIC(12, 2) NOT NULL DEFAULT '0.00',
  "igst_rate" NUMERIC(5, 2) NOT NULL DEFAULT '0.00',
  "igst_amount" NUMERIC(12, 2) NOT NULL DEFAULT '0.00',
  "cgst_rate" NUMERIC(5, 2) NOT NULL DEFAULT '0.00',
  "cgst_amount" NUMERIC(12, 2) NOT NULL DEFAULT '0.00',
  "sgst_rate" NUMERIC(5, 2) NOT NULL DEFAULT '0.00',
  "sgst_amount" NUMERIC(12, 2) NOT NULL DEFAULT '0.00',
  "round_off" NUMERIC(12, 2) NOT NULL DEFAULT '0.00',
  "grand_total" NUMERIC(12, 2) NOT NULL DEFAULT '0.00',
  "status" VARCHAR(50) NOT NULL DEFAULT 'DRAFT',
  "reason" TEXT,
  "notes" TEXT,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "created_by" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "uq_purchase_return_number" UNIQUE ("business_id", "return_number")
);

CREATE INDEX IF NOT EXISTS "purchase_returns_biz_idx" ON "purchase_returns" ("business_id");
CREATE INDEX IF NOT EXISTS "purchase_returns_invoice_idx" ON "purchase_returns" ("purchase_invoice_id");
CREATE INDEX IF NOT EXISTS "purchase_returns_supplier_idx" ON "purchase_returns" ("supplier_party_id");
CREATE INDEX IF NOT EXISTS "purchase_returns_status_idx" ON "purchase_returns" ("status");
CREATE INDEX IF NOT EXISTS "purchase_returns_date_idx" ON "purchase_returns" ("return_date");

-- 37. Purchase Return Lines Table
CREATE TABLE IF NOT EXISTS "purchase_return_lines" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "purchase_return_id" UUID NOT NULL REFERENCES "purchase_returns"("id") ON DELETE CASCADE,
  "purchase_invoice_line_id" UUID NOT NULL REFERENCES "purchase_invoice_lines"("id") ON DELETE RESTRICT,
  "unique_item_id" UUID NOT NULL REFERENCES "unique_items"("id") ON DELETE RESTRICT,
  "quantity" NUMERIC(12, 2) NOT NULL,
  "rate" NUMERIC(12, 2) NOT NULL,
  "discount_type" VARCHAR(20) NOT NULL DEFAULT 'NONE',
  "discount_value" NUMERIC(12, 2) NOT NULL DEFAULT '0.00',
  "discount_amount" NUMERIC(12, 2) NOT NULL DEFAULT '0.00',
  "taxable_amount" NUMERIC(12, 2) NOT NULL,
  "gst_rate" NUMERIC(5, 2) NOT NULL DEFAULT '0.00',
  "tax_amount" NUMERIC(12, 2) NOT NULL DEFAULT '0.00',
  "line_total" NUMERIC(12, 2) NOT NULL,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "purchase_return_lines_return_idx" ON "purchase_return_lines" ("purchase_return_id");
CREATE INDEX IF NOT EXISTS "purchase_return_lines_inv_line_idx" ON "purchase_return_lines" ("purchase_invoice_line_id");
CREATE INDEX IF NOT EXISTS "purchase_return_lines_item_idx" ON "purchase_return_lines" ("unique_item_id");

-- 38. Purchase Return Line Batches Table
CREATE TABLE IF NOT EXISTS "purchase_return_line_batches" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "purchase_return_line_id" UUID NOT NULL REFERENCES "purchase_return_lines"("id") ON DELETE CASCADE,
  "batch_id" UUID NOT NULL REFERENCES "optical_batches"("id") ON DELETE RESTRICT,
  "purchase_lot_id" UUID REFERENCES "purchase_lots"("id") ON DELETE SET NULL,
  "quantity" NUMERIC(12, 2) NOT NULL,
  "rate" NUMERIC(12, 2) NOT NULL,
  "total_cost" NUMERIC(12, 2) NOT NULL,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "purchase_return_line_batches_line_idx" ON "purchase_return_line_batches" ("purchase_return_line_id");
CREATE INDEX IF NOT EXISTS "purchase_return_line_batches_batch_idx" ON "purchase_return_line_batches" ("batch_id");
CREATE INDEX IF NOT EXISTS "purchase_return_line_batches_lot_idx" ON "purchase_return_line_batches" ("purchase_lot_id");

-- 39. Payments Table
CREATE TABLE IF NOT EXISTS "payments" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "party_id" UUID NOT NULL REFERENCES "parties"("id") ON DELETE RESTRICT,
  "payment_number" VARCHAR(100) NOT NULL,
  "payment_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "payment_type" VARCHAR(20) NOT NULL,
  "payment_mode" VARCHAR(50) NOT NULL,
  "amount" NUMERIC(12, 2) NOT NULL,
  "unallocated_amount" NUMERIC(12, 2) NOT NULL DEFAULT '0.00',
  "reference_number" VARCHAR(100),
  "reference_date" TIMESTAMP WITH TIME ZONE,
  "bank_name" VARCHAR(255),
  "notes" TEXT,
  "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  "created_by" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "uq_payments_biz_number" UNIQUE ("business_id", "payment_number")
);

CREATE INDEX IF NOT EXISTS "payments_biz_idx" ON "payments" ("business_id");
CREATE INDEX IF NOT EXISTS "payments_party_idx" ON "payments" ("party_id");
CREATE INDEX IF NOT EXISTS "payments_type_idx" ON "payments" ("payment_type");
CREATE INDEX IF NOT EXISTS "payments_status_idx" ON "payments" ("status");
CREATE INDEX IF NOT EXISTS "payments_date_idx" ON "payments" ("payment_date");
CREATE INDEX IF NOT EXISTS "payments_mode_idx" ON "payments" ("payment_mode");

-- 40. Payment Allocations Table
CREATE TABLE IF NOT EXISTS "payment_allocations" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "payment_id" UUID NOT NULL REFERENCES "payments"("id") ON DELETE CASCADE,
  "party_id" UUID NOT NULL REFERENCES "parties"("id") ON DELETE RESTRICT,
  "document_type" VARCHAR(50) NOT NULL,
  "document_id" UUID NOT NULL,
  "allocated_amount" NUMERIC(12, 2) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  "notes" TEXT,
  "created_by" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "payment_allocations_biz_idx" ON "payment_allocations" ("business_id");
CREATE INDEX IF NOT EXISTS "payment_allocations_payment_idx" ON "payment_allocations" ("payment_id");
CREATE INDEX IF NOT EXISTS "payment_allocations_party_idx" ON "payment_allocations" ("party_id");
CREATE INDEX IF NOT EXISTS "payment_allocations_doc_idx" ON "payment_allocations" ("document_type", "document_id");
CREATE INDEX IF NOT EXISTS "payment_allocations_status_idx" ON "payment_allocations" ("status");

-- 41. Import Sessions Table
CREATE TABLE IF NOT EXISTS "import_sessions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "import_type" VARCHAR(50) NOT NULL,
  "file_name" VARCHAR(255) NOT NULL,
  "file_size" NUMERIC NOT NULL DEFAULT 0,
  "status" VARCHAR(50) NOT NULL DEFAULT 'UPLOADED',
  "total_rows" NUMERIC NOT NULL DEFAULT 0,
  "valid_rows" NUMERIC NOT NULL DEFAULT 0,
  "invalid_rows" NUMERIC NOT NULL DEFAULT 0,
  "duplicate_rows" NUMERIC NOT NULL DEFAULT 0,
  "posted_rows" NUMERIC NOT NULL DEFAULT 0,
  "failed_rows" NUMERIC NOT NULL DEFAULT 0,
  "column_mapping" JSONB,
  "preview_data" JSONB,
  "error_summary" JSONB,
  "posted_document_ids" JSONB,
  "created_by" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "started_at" TIMESTAMP WITH TIME ZONE,
  "completed_at" TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS "import_sessions_biz_idx" ON "import_sessions" ("business_id");
CREATE INDEX IF NOT EXISTS "import_sessions_type_idx" ON "import_sessions" ("import_type");
CREATE INDEX IF NOT EXISTS "import_sessions_status_idx" ON "import_sessions" ("status");
CREATE INDEX IF NOT EXISTS "import_sessions_created_at_idx" ON "import_sessions" ("created_at");

-- 42. Business Settings Table
CREATE TABLE IF NOT EXISTS "business_settings" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "low_stock_threshold" NUMERIC(10, 2) NOT NULL DEFAULT 1.00,
  "config" JSONB DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "uq_business_settings_biz" UNIQUE ("business_id")
);

CREATE INDEX IF NOT EXISTS "business_settings_biz_idx" ON "business_settings" ("business_id");

-- Performance Indexes for Operational Reports
CREATE INDEX IF NOT EXISTS "optical_stocks_physical_idx" ON "optical_stocks" ("physical_stock");
CREATE INDEX IF NOT EXISTS "sales_invoices_biz_date_idx" ON "sales_invoices" ("business_id", "invoice_date");
CREATE INDEX IF NOT EXISTS "purchase_invoices_biz_date_idx" ON "purchase_invoices" ("business_id", "invoice_date");
CREATE INDEX IF NOT EXISTS "payments_biz_date_idx" ON "payments" ("business_id", "payment_date");
`;

export const SYSTEM_PERMISSIONS = [
  // Sales Module
  { module: 'sales', action: 'view', code: 'sales:view', description: 'View sales orders, invoices, and returns' },
  { module: 'sales', action: 'view', code: 'sales.view', description: 'View sales orders, invoices (dot notation)' },
  { module: 'sales', action: 'order_view', code: 'sales.order.view', description: 'View sales orders' },
  { module: 'sales', action: 'order_view', code: 'sales:order:view', description: 'View sales orders' },
  { module: 'sales', action: 'create', code: 'sales:create', description: 'Create new sales orders and invoices' },
  { module: 'sales', action: 'create', code: 'sales.create', description: 'Create sales orders and invoices (dot notation)' },
  { module: 'sales', action: 'order_create', code: 'sales.order.create', description: 'Create sales orders' },
  { module: 'sales', action: 'order_create', code: 'sales:order:create', description: 'Create sales orders' },
  { module: 'sales', action: 'edit', code: 'sales:edit', description: 'Edit pending sales documents' },
  { module: 'sales', action: 'edit', code: 'sales.edit', description: 'Edit pending sales documents (dot notation)' },
  { module: 'sales', action: 'order_edit', code: 'sales.order.edit', description: 'Edit pending sales orders' },
  { module: 'sales', action: 'order_edit', code: 'sales:order:edit', description: 'Edit pending sales orders' },
  { module: 'sales', action: 'order_confirm', code: 'sales.order.confirm', description: 'Confirm sales order and reserve inventory' },
  { module: 'sales', action: 'order_confirm', code: 'sales:order:confirm', description: 'Confirm sales order and reserve inventory' },
  { module: 'sales', action: 'order_cancel', code: 'sales.order.cancel', description: 'Cancel sales orders and release reservations' },
  { module: 'sales', action: 'order_cancel', code: 'sales:order:cancel', description: 'Cancel sales orders and release reservations' },
  { module: 'sales', action: 'invoice_view', code: 'sales.invoice.view', description: 'View sales invoices' },
  { module: 'sales', action: 'invoice_view', code: 'sales:invoice:view', description: 'View sales invoices' },
  { module: 'sales', action: 'invoice_create', code: 'sales.invoice.create', description: 'Create sales invoices' },
  { module: 'sales', action: 'invoice_create', code: 'sales:invoice:create', description: 'Create sales invoices' },
  { module: 'sales', action: 'invoice_edit', code: 'sales.invoice.edit', description: 'Edit draft sales invoices' },
  { module: 'sales', action: 'invoice_edit', code: 'sales:invoice:edit', description: 'Edit draft sales invoices' },
  { module: 'sales', action: 'invoice_post', code: 'sales.invoice.post', description: 'Post sales invoice to stock and customer ledger' },
  { module: 'sales', action: 'invoice_post', code: 'sales:invoice:post', description: 'Post sales invoice to stock and customer ledger' },
  { module: 'sales', action: 'invoice_cancel', code: 'sales.invoice.cancel', description: 'Cancel finalized sales invoice and reverse stock' },
  { module: 'sales', action: 'invoice_cancel', code: 'sales:invoice:cancel', description: 'Cancel finalized sales invoice and reverse stock' },
  { module: 'sales', action: 'return_view', code: 'sales:return:view', description: 'View sales return credit notes' },
  { module: 'sales', action: 'return_view', code: 'sales.return.view', description: 'View sales return credit notes (dot notation)' },
  { module: 'sales', action: 'return_create', code: 'sales:return:create', description: 'Create sales return credit notes' },
  { module: 'sales', action: 'return_create', code: 'sales.return.create', description: 'Create sales return credit notes (dot notation)' },
  { module: 'sales', action: 'return_post', code: 'sales:return:post', description: 'Post sales return and restore original batch stock' },
  { module: 'sales', action: 'return_post', code: 'sales.return.post', description: 'Post sales return and restore original batch stock (dot notation)' },
  { module: 'sales', action: 'return_cancel', code: 'sales:return:cancel', description: 'Cancel sales return document' },
  { module: 'sales', action: 'return_cancel', code: 'sales.return.cancel', description: 'Cancel sales return document (dot notation)' },
  { module: 'sales', action: 'delete', code: 'sales:delete', description: 'Delete draft sales orders' },
  { module: 'sales', action: 'cancel', code: 'sales:cancel', description: 'Cancel finalized sales invoices' },
  { module: 'sales', action: 'approve', code: 'sales:approve', description: 'Approve special discounts or credit limits' },
  { module: 'sales', action: 'export', code: 'sales:export', description: 'Export sales registers and reports' },
  { module: 'sales', action: 'edit_sale_price', code: 'sales:edit_sale_price', description: 'Override default sales price on items' },
  { module: 'sales', action: 'price_override', code: 'sales.price.override', description: 'Override default sales price on items' },
  { module: 'sales', action: 'price_override', code: 'sales:price:override', description: 'Override default sales price on items' },

  // Purchase Module
  { module: 'purchase', action: 'view', code: 'purchase:view', description: 'View purchase orders, inward bills and returns' },
  { module: 'purchase', action: 'create', code: 'purchase:create', description: 'Record supplier purchase invoices' },
  { module: 'purchase', action: 'edit', code: 'purchase:edit', description: 'Edit purchase records before posting' },
  { module: 'purchase', action: 'post', code: 'purchase:post', description: 'Finalize and post purchase invoice to inventory and ledger' },
  { module: 'purchase', action: 'delete', code: 'purchase:delete', description: 'Delete draft purchase entries' },
  { module: 'purchase', action: 'delete_draft', code: 'purchase:delete_draft', description: 'Delete unposted draft purchase entries' },
  { module: 'purchase', action: 'cancel', code: 'purchase:cancel', description: 'Cancel posted purchase documents and reverse stock' },
  { module: 'purchase', action: 'return_view', code: 'purchase:return:view', description: 'View purchase return debit notes' },
  { module: 'purchase', action: 'return_view', code: 'purchase.return.view', description: 'View purchase return debit notes (dot notation)' },
  { module: 'purchase', action: 'return_create', code: 'purchase:return:create', description: 'Create purchase return debit notes' },
  { module: 'purchase', action: 'return_create', code: 'purchase.return.create', description: 'Create purchase return debit notes (dot notation)' },
  { module: 'purchase', action: 'return_post', code: 'purchase:return:post', description: 'Post purchase return and reduce stock & lot' },
  { module: 'purchase', action: 'return_post', code: 'purchase.return.post', description: 'Post purchase return and reduce stock & lot (dot notation)' },
  { module: 'purchase', action: 'return_cancel', code: 'purchase:return:cancel', description: 'Cancel purchase return document' },
  { module: 'purchase', action: 'return_cancel', code: 'purchase.return.cancel', description: 'Cancel purchase return document (dot notation)' },
  { module: 'purchase', action: 'approve', code: 'purchase:approve', description: 'Approve vendor inward stock' },
  { module: 'purchase', action: 'view_purchase_price', code: 'purchase:view_purchase_price', description: 'View supplier landed cost and purchase rates' },
  { module: 'purchase', action: 'export', code: 'purchase:export', description: 'Export purchase registers' },

  // Inventory Module
  { module: 'inventory', action: 'view', code: 'inventory:view', description: 'View frame, lens, contact lens stock' },
  { module: 'inventory', action: 'view', code: 'inventory.view', description: 'View frame, lens, contact lens stock (dot notation)' },
  { module: 'inventory', action: 'create', code: 'inventory:create', description: 'Add new optical SKU or batch records' },
  { module: 'inventory', action: 'edit', code: 'inventory:edit', description: 'Update item specifications, brand, model' },
  { module: 'inventory', action: 'delete', code: 'inventory:delete', description: 'Remove obsolete unlinked item masters' },
  { module: 'inventory', action: 'adjust', code: 'inventory:adjust', description: 'Perform physical stock count reconciliation and adjustments' },
  { module: 'inventory', action: 'adjust', code: 'inventory.adjust', description: 'Perform physical stock count reconciliation and adjustments (dot notation)' },
  { module: 'inventory', action: 'adjust_stock', code: 'inventory:adjust_stock', description: 'Perform physical stock count reconciliation and adjustments (legacy code)' },
  { module: 'inventory', action: 'opening_stock', code: 'inventory:opening_stock', description: 'Post initial opening stock balances for optical batches' },
  { module: 'inventory', action: 'opening_stock', code: 'inventory.opening_stock', description: 'Post initial opening stock balances (dot notation)' },
  { module: 'inventory', action: 'reservation_view', code: 'inventory:reservation:view', description: 'View stock reservations' },
  { module: 'inventory', action: 'reservation_view', code: 'inventory.reservation.view', description: 'View stock reservations (dot notation)' },
  { module: 'inventory', action: 'reservation_create', code: 'inventory:reservation:create', description: 'Create stock hold reservation' },
  { module: 'inventory', action: 'reservation_create', code: 'inventory.reservation.create', description: 'Create stock hold reservation (dot notation)' },
  { module: 'inventory', action: 'reservation_release', code: 'inventory:reservation:release', description: 'Release stock reservation back to available' },
  { module: 'inventory', action: 'reservation_release', code: 'inventory.reservation.release', description: 'Release stock reservation (dot notation)' },
  { module: 'inventory', action: 'reservation_cancel', code: 'inventory:reservation:cancel', description: 'Cancel stock reservation' },
  { module: 'inventory', action: 'reservation_cancel', code: 'inventory.reservation.cancel', description: 'Cancel stock reservation (dot notation)' },
  { module: 'inventory', action: 'reservation_convert', code: 'inventory:reservation:convert', description: 'Convert reservation into sales delivery / stock consumption' },
  { module: 'inventory', action: 'reservation_convert', code: 'inventory.reservation.convert', description: 'Convert reservation (dot notation)' },
  { module: 'inventory', action: 'import', code: 'inventory:import', description: 'Bulk import optical item lists via CSV/Excel' },
  { module: 'inventory', action: 'export', code: 'inventory:export', description: 'Export current stock valuation and barcode lists' },

  // Parties Module
  { module: 'parties', action: 'view', code: 'parties:view', description: 'View customer optical prescriptions and supplier records' },
  { module: 'parties', action: 'create', code: 'parties:create', description: 'Create new customer or supplier profiles' },
  { module: 'parties', action: 'edit', code: 'parties:edit', description: 'Update party details, prescription history, GSTIN' },
  { module: 'parties', action: 'delete', code: 'parties:delete', description: 'Delete unused party profiles' },
  { module: 'parties', action: 'export', code: 'parties:export', description: 'Export party directories and ledgers' },

  // Accounts Module
  { module: 'accounts', action: 'view', code: 'accounts:view', description: 'View customer receipts, supplier payments, outstandings' },
  { module: 'accounts', action: 'create', code: 'accounts:create', description: 'Record payment vouchers and receipts' },
  { module: 'accounts', action: 'edit', code: 'accounts:edit', description: 'Modify accounting voucher entries' },
  { module: 'accounts', action: 'delete', code: 'accounts:delete', description: 'Remove un-reconciled voucher drafts' },
  { module: 'accounts', action: 'approve', code: 'accounts:approve', description: 'Approve bank reconciliations and settlement' },
  { module: 'accounts', action: 'export', code: 'accounts:export', description: 'Export financial ledgers and trial balance' },

  // Phase 6: Payments & Settlements Permissions
  { module: 'payment', action: 'receipt_view', code: 'payment.receipt.view', description: 'View customer receipt vouchers' },
  { module: 'payment', action: 'receipt_view', code: 'payment:receipt:view', description: 'View customer receipt vouchers (colon notation)' },
  { module: 'payment', action: 'receipt_create', code: 'payment.receipt.create', description: 'Create customer receipt vouchers' },
  { module: 'payment', action: 'receipt_create', code: 'payment:receipt:create', description: 'Create customer receipt vouchers (colon notation)' },
  { module: 'payment', action: 'receipt_post', code: 'payment.receipt.post', description: 'Post and finalize customer receipts' },
  { module: 'payment', action: 'receipt_post', code: 'payment:receipt:post', description: 'Post and finalize customer receipts (colon notation)' },
  { module: 'payment', action: 'receipt_cancel', code: 'payment.receipt.cancel', description: 'Cancel customer receipts and reverse ledger' },
  { module: 'payment', action: 'receipt_cancel', code: 'payment:receipt:cancel', description: 'Cancel customer receipts and reverse ledger (colon notation)' },

  { module: 'payment', action: 'supplier_view', code: 'payment.supplier.view', description: 'View supplier payment vouchers' },
  { module: 'payment', action: 'supplier_view', code: 'payment:supplier:view', description: 'View supplier payment vouchers (colon notation)' },
  { module: 'payment', action: 'supplier_create', code: 'payment.supplier.create', description: 'Create supplier payment vouchers' },
  { module: 'payment', action: 'supplier_create', code: 'payment:supplier:create', description: 'Create supplier payment vouchers (colon notation)' },
  { module: 'payment', action: 'supplier_post', code: 'payment.supplier.post', description: 'Post and finalize supplier payments' },
  { module: 'payment', action: 'supplier_post', code: 'payment:supplier:post', description: 'Post and finalize supplier payments (colon notation)' },
  { module: 'payment', action: 'supplier_cancel', code: 'payment.supplier.cancel', description: 'Cancel supplier payments and reverse ledger' },
  { module: 'payment', action: 'supplier_cancel', code: 'payment:supplier:cancel', description: 'Cancel supplier payments and reverse ledger (colon notation)' },

  { module: 'payment', action: 'allocation_view', code: 'payment.allocation.view', description: 'View invoice payment allocations' },
  { module: 'payment', action: 'allocation_view', code: 'payment:allocation:view', description: 'View invoice payment allocations (colon notation)' },
  { module: 'payment', action: 'allocation_create', code: 'payment.allocation.create', description: 'Create invoice payment allocations' },
  { module: 'payment', action: 'allocation_create', code: 'payment:allocation:create', description: 'Create invoice payment allocations (colon notation)' },

  // Reports Module
  { module: 'reports', action: 'view', code: 'reports:view', description: 'Access optical business intelligence and analytical reports' },
  { module: 'reports', action: 'export', code: 'reports:export', description: 'Download GST GSTR-1 / GSTR-3B audit summaries' },
  { module: 'reports', action: 'dashboard_view', code: 'report.dashboard.view', description: 'View executive operational KPI dashboard' },
  { module: 'reports', action: 'dashboard_view', code: 'reports:dashboard:view', description: 'View executive operational KPI dashboard (colon notation)' },
  { module: 'reports', action: 'inventory_view', code: 'report.inventory.view', description: 'View comprehensive inventory & optical stock reports' },
  { module: 'reports', action: 'inventory_view', code: 'reports:inventory', description: 'View comprehensive inventory & optical stock reports (colon notation)' },
  { module: 'reports', action: 'stock_ledger_view', code: 'report.stock_ledger.view', description: 'View chronological batch stock ledger journal reports' },
  { module: 'reports', action: 'stock_ledger_view', code: 'reports:stock_ledger', description: 'View chronological batch stock ledger journal reports (colon notation)' },
  { module: 'reports', action: 'purchase_view', code: 'report.purchase.view', description: 'View supplier purchase register and detailed lot reports' },
  { module: 'reports', action: 'purchase_view', code: 'reports:purchase', description: 'View supplier purchase register and detailed lot reports (colon notation)' },
  { module: 'reports', action: 'sales_view', code: 'report.sales.view', description: 'View customer sales register and item/power reports' },
  { module: 'reports', action: 'sales_view', code: 'reports:sales', description: 'View customer sales register and item/power reports (colon notation)' },
  { module: 'reports', action: 'outstanding_view', code: 'report.outstanding.view', description: 'View customer and supplier outstanding aging reports' },
  { module: 'reports', action: 'outstanding_view', code: 'reports:outstanding', description: 'View customer and supplier outstanding aging reports (colon notation)' },
  { module: 'reports', action: 'payment_view', code: 'report.payment.view', description: 'View payment register and mode summary reports' },
  { module: 'reports', action: 'payment_view', code: 'reports:payment', description: 'View payment register and mode summary reports (colon notation)' },
  { module: 'reports', action: 'party_statement_view', code: 'report.party_statement.view', description: 'View individual party running balance statements' },
  { module: 'reports', action: 'party_statement_view', code: 'reports:party_statement', description: 'View individual party running balance statements (colon notation)' },

  // Administration Module
  { module: 'admin', action: 'manage_users', code: 'admin:manage_users', description: 'Create, update, lock, and assign roles to users' },
  { module: 'admin', action: 'manage_roles', code: 'admin:manage_roles', description: 'Configure custom roles and permission assignments' },
  { module: 'admin', action: 'manage_settings', code: 'admin:manage_settings', description: 'Configure business GST, invoice prefixes, and barcode settings' },
  { module: 'admin', action: 'view_audit_logs', code: 'admin:view_audit_logs', description: 'Inspect audit trails of all system modifications' },

  // Phase 7: Bulk Data & Import Permissions
  { module: 'import', action: 'view', code: 'import:view', description: 'View bulk import history and templates' },
  { module: 'import', action: 'view', code: 'import.view', description: 'View bulk import history and templates (dot notation)' },
  { module: 'import', action: 'party', code: 'import:party', description: 'Bulk import customer and supplier directories' },
  { module: 'import', action: 'party', code: 'import.party', description: 'Bulk import customer and supplier directories (dot notation)' },
  { module: 'import', action: 'purchase', code: 'import:purchase', description: 'Bulk import supplier purchase invoices' },
  { module: 'import', action: 'purchase', code: 'import.purchase', description: 'Bulk import supplier purchase invoices (dot notation)' },
  { module: 'import', action: 'sales_order', code: 'import:sales_order', description: 'Bulk import customer sales orders' },
  { module: 'import', action: 'sales_order', code: 'import.sales_order', description: 'Bulk import customer sales orders (dot notation)' },
  { module: 'import', action: 'sales_invoice', code: 'import:sales_invoice', description: 'Bulk import customer sales invoices' },
  { module: 'import', action: 'sales_invoice', code: 'import.sales_invoice', description: 'Bulk import customer sales invoices (dot notation)' },
  { module: 'import', action: 'opening_stock', code: 'import:opening_stock', description: 'Bulk import initial optical batch opening stock balances' },
  { module: 'import', action: 'opening_stock', code: 'import.opening_stock', description: 'Bulk import initial optical batch opening stock balances (dot notation)' },
];

export const SYSTEM_ROLES = [
  {
    name: 'Super Administrator',
    code: 'SUPER_ADMIN',
    description: 'Complete unrestricted access across all multi-business modules, users, security, and accounting.',
    isSystem: true,
  },
  {
    name: 'Store Manager',
    code: 'MANAGER',
    description: 'Store-level managerial oversight for billing, purchase approvals, stock audits, and party ledgers.',
    isSystem: true,
  },
  {
    name: 'Sales Executive',
    code: 'SALES_USER',
    description: 'Optical counter sales, customer prescription entry, invoice creation, and payment collection.',
    isSystem: true,
  },
  {
    name: 'Purchase Executive',
    code: 'PURCHASE_USER',
    description: 'Supplier orders, frame/lens inward billing, landed cost inspection, and vendor returns.',
    isSystem: true,
  },
  {
    name: 'Inventory Manager',
    code: 'INVENTORY_USER',
    description: 'Barcode generation, physical stock adjustments, lens batch tracking, and min-stock monitoring.',
    isSystem: true,
  },
  {
    name: 'Accounts Executive',
    code: 'ACCOUNTS_USER',
    description: 'Payment settlements, party ledger reconciliation, outstanding aging analysis, and GST reports.',
    isSystem: true,
  },
  {
    name: 'Read-Only Viewer',
    code: 'VIEWER',
    description: 'Read-only access to sales, purchase, stock, customer ledgers, and operational dashboards.',
    isSystem: true,
  },
];

let migrationExecuted = false;

export async function runMigrations(): Promise<{ success: boolean; message: string; tablesCount?: number }> {
  try {
    // Run schema creation directly from inlined SQL definition (resilient to serverless environments)
    await pool.query(INITIAL_SCHEMA_SQL);

    // Auto-migrate column naming variations if table previously created with camelCase or snake_case
    try {
      await pool.query(`
        DO $$ 
        BEGIN 
          -- Ensure full_name exists
          IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='fullName') THEN
            ALTER TABLE "users" RENAME COLUMN "fullName" TO "full_name";
          END IF;
          -- Ensure password_hash exists
          IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='passwordHash') THEN
            ALTER TABLE "users" RENAME COLUMN "passwordHash" TO "password_hash";
          END IF;
          -- Ensure is_super_admin exists
          IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='isSuperAdmin') THEN
            ALTER TABLE "users" RENAME COLUMN "isSuperAdmin" TO "is_super_admin";
          END IF;
          -- Ensure last_login_at exists
          IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='lastLoginAt') THEN
            ALTER TABLE "users" RENAME COLUMN "lastLoginAt" TO "last_login_at";
          END IF;
          -- Ensure payment_status exists on sales_invoices
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sales_invoices' AND column_name='payment_status') THEN
            ALTER TABLE "sales_invoices" ADD COLUMN "payment_status" VARCHAR(20) NOT NULL DEFAULT 'UNPAID';
          END IF;
          -- Ensure payment_status exists on purchase_invoices
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='purchase_invoices' AND column_name='payment_status') THEN
            ALTER TABLE "purchase_invoices" ADD COLUMN "payment_status" VARCHAR(20) NOT NULL DEFAULT 'UNPAID';
          END IF;
        END $$;
      `);
    } catch (colErr: any) {
      console.warn('[Migrations Warning] Non-critical column normalization:', colErr.message);
    }

    // Seed master permissions & roles if not present
    for (const perm of SYSTEM_PERMISSIONS) {
      const existing = await db.select().from(permissions).where(eq(permissions.code, perm.code)).limit(1);
      if (existing.length === 0) {
        await db.insert(permissions).values(perm);
      }
    }

    const allPerms = await db.select().from(permissions);
    const permMap = new Map(allPerms.map(p => [p.code, p.id]));

    for (const roleData of SYSTEM_ROLES) {
      const existing = await db.select().from(roles).where(eq(roles.code, roleData.code)).limit(1);
      let roleId = existing[0]?.id;
      if (!roleId) {
        const [inserted] = await db.insert(roles).values(roleData).returning();
        roleId = inserted.id;
      }

      // Map role permissions
      let allowedCodes: string[] = [];
      if (roleData.code === 'SUPER_ADMIN') {
        allowedCodes = SYSTEM_PERMISSIONS.map(p => p.code);
      } else if (roleData.code === 'MANAGER') {
        allowedCodes = SYSTEM_PERMISSIONS.filter(p => p.code !== 'admin:manage_roles').map(p => p.code);
      } else if (roleData.code === 'SALES_USER') {
        allowedCodes = [
          'sales:view',
          'sales.view',
          'sales.order.view',
          'sales:order:view',
          'sales:create',
          'sales.create',
          'sales.order.create',
          'sales:order:create',
          'sales:edit',
          'sales.edit',
          'sales.order.edit',
          'sales:order:edit',
          'sales.order.confirm',
          'sales:order:confirm',
          'sales.order.cancel',
          'sales:order:cancel',
          'sales.invoice.view',
          'sales:invoice:view',
          'sales.invoice.create',
          'sales:invoice:create',
          'sales.invoice.edit',
          'sales:invoice:edit',
          'sales.invoice.post',
          'sales:invoice:post',
          'sales.invoice.cancel',
          'sales:invoice:cancel',
          'sales:delete',
          'sales:cancel',
          'sales:approve',
          'sales:export',
          'sales:edit_sale_price',
          'sales.price.override',
          'sales:price:override',
          'sales:return:view',
          'sales.return.view',
          'sales:return:create',
          'sales.return.create',
          'sales:return:post',
          'sales.return.post',
          'sales:return:cancel',
          'sales.return.cancel',
          'parties:view',
          'parties:create',
          'parties:edit',
          'inventory:view',
          'inventory.view',
          'accounts:view',
          'accounts:create',
          'payment.receipt.view',
          'payment:receipt:view',
          'payment.receipt.create',
          'payment:receipt:create',
          'payment.receipt.post',
          'payment:receipt:post',
          'payment.receipt.cancel',
          'payment:receipt:cancel',
          'payment.allocation.view',
          'payment:allocation:view',
          'payment.allocation.create',
          'payment:allocation:create',
          'import:view',
          'import.view',
          'import:sales_order',
          'import.sales_order',
          'import:sales_invoice',
          'import.sales_invoice',
          'import:party',
          'import.party',
        ];
      } else if (roleData.code === 'PURCHASE_USER') {
        allowedCodes = [
          'purchase:view',
          'purchase:create',
          'purchase:edit',
          'purchase:post',
          'purchase:cancel',
          'purchase:return:view',
          'purchase.return.view',
          'purchase:return:create',
          'purchase.return.create',
          'purchase:return:post',
          'purchase.return.post',
          'purchase:return:cancel',
          'purchase.return.cancel',
          'purchase:delete_draft',
          'purchase:delete',
          'purchase:view_purchase_price',
          'purchase:export',
          'parties:view',
          'parties:create',
          'parties:edit',
          'inventory:view',
          'payment.supplier.view',
          'payment:supplier:view',
          'payment.supplier.create',
          'payment:supplier:create',
          'payment.supplier.post',
          'payment:supplier:post',
          'payment.supplier.cancel',
          'payment:supplier:cancel',
          'payment.allocation.view',
          'payment:allocation:view',
          'payment.allocation.create',
          'payment:allocation:create',
          'import:view',
          'import.view',
          'import:purchase',
          'import.purchase',
          'import:party',
          'import.party',
        ];
      } else if (roleData.code === 'INVENTORY_USER') {
        allowedCodes = [
          'inventory:view',
          'inventory.view',
          'inventory:create',
          'inventory:edit',
          'inventory:adjust',
          'inventory.adjust',
          'inventory:adjust_stock',
          'inventory:opening_stock',
          'inventory.opening_stock',
          'inventory:reservation:view',
          'inventory.reservation.view',
          'inventory:reservation:create',
          'inventory.reservation.create',
          'inventory:reservation:release',
          'inventory.reservation.release',
          'inventory:reservation:cancel',
          'inventory.reservation.cancel',
          'inventory:reservation:convert',
          'inventory.reservation.convert',
          'inventory:import',
          'inventory:export',
          'purchase:view',
          'import:view',
          'import.view',
          'import:opening_stock',
          'import.opening_stock',
        ];
      } else if (roleData.code === 'ACCOUNTS_USER') {
        allowedCodes = [
          'accounts:view',
          'accounts:create',
          'accounts:edit',
          'accounts:export',
          'parties:view',
          'parties:export',
          'sales:view',
          'purchase:view',
          'reports:view',
          'reports:export',
          'payment.receipt.view',
          'payment:receipt:view',
          'payment.receipt.create',
          'payment:receipt:create',
          'payment.receipt.post',
          'payment:receipt:post',
          'payment.receipt.cancel',
          'payment:receipt:cancel',
          'payment.supplier.view',
          'payment:supplier:view',
          'payment.supplier.create',
          'payment:supplier:create',
          'payment.supplier.post',
          'payment:supplier:post',
          'payment.supplier.cancel',
          'payment:supplier:cancel',
          'payment.allocation.view',
          'payment:allocation:view',
          'payment.allocation.create',
          'payment:allocation:create',
          'import:view',
          'import.view',
          'import:party',
          'import.party',
        ];
      } else if (roleData.code === 'VIEWER') {
        allowedCodes = [
          'sales:view',
          'purchase:view',
          'inventory:view',
          'parties:view',
          'accounts:view',
          'reports:view',
          'payment.receipt.view',
          'payment:receipt:view',
          'payment.supplier.view',
          'payment:supplier:view',
          'payment.allocation.view',
          'payment:allocation:view',
          'import:view',
          'import.view',
        ];
      }

      for (const code of allowedCodes) {
        const permId = permMap.get(code);
        if (permId && roleId) {
          await pool.query(
            `INSERT INTO role_permissions (role_id, permission_id) 
             VALUES ($1, $2) 
             ON CONFLICT ("role_id", "permission_id") DO NOTHING`,
            [roleId, permId]
          );
        }
      }
    }

    // Verify created tables
    const tableRes = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);

    const tableNames = tableRes.rows.map(r => r.table_name);
    migrationExecuted = true;
    console.log(`[Migrations] Successfully initialized ${tableNames.length} tables in PostgreSQL:`, tableNames.join(', '));

    return {
      success: true,
      message: `Database migrations executed successfully. ${tableNames.length} tables verified.`,
      tablesCount: tableNames.length,
    };
  } catch (error: any) {
    console.error('[Migrations Error]', error);
    return {
      success: false,
      message: error.message || 'Migration execution failed',
    };
  }
}

/**
 * Ensures migrations have run at least once during application runtime lifecycle
 */
export async function ensureMigrationsRun(): Promise<void> {
  if (!migrationExecuted) {
    await runMigrations();
  }
}

// Standalone execution support via `npm run db:migrate`
if (typeof process !== 'undefined' && process.argv && process.argv[1] && process.argv[1].endsWith('migrate.ts')) {
  runMigrations()
    .then(async (res) => {
      console.log(res.message);
      try {
        await pool.end();
      } catch {}
      process.exit(res.success ? 0 : 1);
    })
    .catch(async (err) => {
      console.error(err);
      try {
        await pool.end();
      } catch {}
      process.exit(1);
    });
}

