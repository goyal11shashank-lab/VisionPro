-- 0002_maintain_batches.sql
-- Phase 4 Migration: Stock Item "Maintain Batches" Control
--
-- 1. Adds maintain_batches column to unique_items table (default FALSE, NOT NULL)
-- 2. Safely migrates existing data:
--    - Stock items with 1 or more optical_batches -> maintain_batches = TRUE
--    - Stock items with 0 optical_batches -> maintain_batches = FALSE
-- 3. Preserves all existing relationships, batches, stocks, and ledgers.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'unique_items' 
      AND column_name = 'maintain_batches'
  ) THEN
    -- Add column with default FALSE
    ALTER TABLE "unique_items" ADD COLUMN "maintain_batches" BOOLEAN NOT NULL DEFAULT FALSE;
    RAISE NOTICE 'Added maintain_batches column to unique_items.';

    -- Data migration: Set maintain_batches = TRUE for items with 1 or more optical_batches
    UPDATE "unique_items"
    SET "maintain_batches" = TRUE
    WHERE "id" IN (
      SELECT DISTINCT "unique_item_id" 
      FROM "optical_batches"
      WHERE "unique_item_id" IS NOT NULL
    );
    RAISE NOTICE 'Migrated existing stock items: maintain_batches set to TRUE for items with batches.';
  ELSE
    RAISE NOTICE 'unique_items.maintain_batches already exists.';
  END IF;
END $$;
