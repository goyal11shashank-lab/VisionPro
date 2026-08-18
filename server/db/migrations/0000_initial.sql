-- 0000_initial.sql: PostgreSQL Migration for Multi-tenant Optical ERP Foundation

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
