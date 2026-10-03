CREATE TYPE "public"."document_type" AS ENUM('tax_invoice', 'bill_of_supply', 'bill');--> statement-breakpoint
CREATE TYPE "public"."gst_scheme" AS ENUM('regular', 'composition');--> statement-breakpoint
ALTER TYPE "public"."ledger_type" ADD VALUE 'payment_reversed';--> statement-breakpoint
DROP INDEX "bills_store_number_unique";--> statement-breakpoint
ALTER TABLE "bill_items" ADD COLUMN "hsn_code" varchar(8);--> statement-breakpoint
ALTER TABLE "bill_items" ADD COLUMN "gst_rate" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "bill_items" ADD COLUMN "taxable_value" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bill_items" ADD COLUMN "cgst" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bill_items" ADD COLUMN "sgst" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bill_items" ADD COLUMN "igst" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "upfront_amount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "upfront_method" "payment_method";--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "paid_cash" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "paid_upi" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "credit_amount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "taxable_total" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "cgst_total" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "sgst_total" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "igst_total" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "document_type" "document_type";--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "invoice_number" varchar(16);--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "place_of_supply" varchar(60);--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "gstin" varchar(15);--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "messaging_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "messaging_consent_source" varchar(30);--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "hsn_code" varchar(8);--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "gst_rate" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD COLUMN "reverses_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "address" varchar(200);--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "gst_scheme" "gst_scheme";--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "prices_include_tax" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "bill_counter_fy" varchar(7);--> statement-breakpoint
CREATE UNIQUE INDEX "bills_store_invoice_unique" ON "bills" USING btree ("store_id","invoice_number");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_reverses_unique" ON "ledger_entries" USING btree ("reverses_entry_id");--> statement-breakpoint
-- Backfill bills confirmed before part payments and GST existed: settle by payment mode,
-- mark them as plain bills and give them a legacy invoice number.
UPDATE "bills" SET
  "paid_cash" = CASE WHEN "payment_mode" = 'cash' THEN "total" ELSE 0 END,
  "paid_upi" = CASE WHEN "payment_mode" = 'upi' THEN "total" ELSE 0 END,
  "credit_amount" = CASE WHEN "payment_mode" = 'udhaar' THEN "total" ELSE 0 END,
  "document_type" = 'bill',
  "invoice_number" = 'OLD/' || lpad("bill_number"::text, 4, '0')
WHERE "status" <> 'draft' AND "bill_number" IS NOT NULL;--> statement-breakpoint
UPDATE "bills" SET "taxable_total" = "total";--> statement-breakpoint
UPDATE "bill_items" SET "taxable_value" = "amount";--> statement-breakpoint
-- Existing paid-at-counter bills now count towards "jama" so that kharid − jama = baaki.
UPDATE "customers" c SET "total_paid" = c."total_paid" + coalesce((
  SELECT sum(b."paid_cash" + b."paid_upi") FROM "bills" b WHERE b."customer_id" = c."id" AND b."status" = 'confirmed'
), 0);
