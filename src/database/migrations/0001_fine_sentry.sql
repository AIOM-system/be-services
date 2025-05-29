ALTER TABLE "public"."product_inventory_logs" ALTER COLUMN "change_type" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."inventory_change_type";--> statement-breakpoint
CREATE TYPE "public"."inventory_change_type" AS ENUM('import', 'return', 'check', 'manual', 'system', 'order');--> statement-breakpoint
ALTER TABLE "public"."product_inventory_logs" ALTER COLUMN "change_type" SET DATA TYPE "public"."inventory_change_type" USING "change_type"::"public"."inventory_change_type";