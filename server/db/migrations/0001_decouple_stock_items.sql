-- 0001_decouple_stock_items.sql
-- Phase 3 Migration: Decouple Stock Item (unique_items) from Legacy Master Data (primary_items)
--
-- Safely drops NOT NULL constraint on primary_item_id in unique_items table
-- Allows standalone Stock Items without requiring Category, Base, Coating, Compatibility, or Primary Item.
-- Preserves existing data, foreign keys, and indexes.

DO $$
BEGIN
  -- Check if unique_items table exists and primary_item_id column has NOT NULL constraint
  IF EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'unique_items' 
      AND column_name = 'primary_item_id' 
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE "unique_items" ALTER COLUMN "primary_item_id" DROP NOT NULL;
    RAISE NOTICE 'Successfully altered unique_items.primary_item_id to nullable.';
  ELSE
    RAISE NOTICE 'unique_items.primary_item_id is already nullable or table does not exist.';
  END IF;
END $$;
