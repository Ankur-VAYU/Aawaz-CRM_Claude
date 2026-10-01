CREATE TYPE "public"."bill_source" AS ENUM('voice', 'text', 'manual');--> statement-breakpoint
CREATE TYPE "public"."bill_status" AS ENUM('draft', 'confirmed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."item_unit" AS ENUM('kg', 'g', 'l', 'ml', 'pc');--> statement-breakpoint
CREATE TYPE "public"."ledger_type" AS ENUM('bill', 'payment', 'bill_cancelled');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('pending', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."message_type" AS ENUM('receipt', 'reminder', 'daily_summary');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash', 'upi');--> statement-breakpoint
CREATE TYPE "public"."payment_mode" AS ENUM('cash', 'upi', 'udhaar');--> statement-breakpoint
CREATE TYPE "public"."reply_style" AS ENUM('voice_text', 'text');--> statement-breakpoint
CREATE TYPE "public"."store_language" AS ENUM('hi', 'hinglish');--> statement-breakpoint
CREATE TABLE "bill_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bill_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"item_id" uuid,
	"name" varchar(80) NOT NULL,
	"size_label" varchar(20),
	"quantity" numeric(12, 3) NOT NULL,
	"unit_price" bigint NOT NULL,
	"amount" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"bill_number" integer,
	"customer_id" uuid,
	"status" "bill_status" DEFAULT 'draft' NOT NULL,
	"payment_mode" "payment_mode" DEFAULT 'cash' NOT NULL,
	"total" bigint DEFAULT 0 NOT NULL,
	"source" "bill_source" DEFAULT 'manual' NOT NULL,
	"transcript" text,
	"spoken_customer_name" varchar(120),
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"client_id" varchar(64),
	"receipt_token" varchar(64) NOT NULL,
	"confirmed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"phone" varchar(16),
	"balance" bigint DEFAULT 0 NOT NULL,
	"total_purchases" bigint DEFAULT 0 NOT NULL,
	"total_paid" bigint DEFAULT 0 NOT NULL,
	"last_purchase_at" timestamp with time zone,
	"share_token" varchar(64) NOT NULL,
	"messages_opted_out_at" timestamp with time zone,
	"deletion_requested_at" timestamp with time zone,
	"anonymized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"name_key" varchar(80) GENERATED ALWAYS AS (lower(name)) STORED,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"unit" "item_unit" DEFAULT 'pc' NOT NULL,
	"unit_size" numeric(12, 3) DEFAULT 1 NOT NULL,
	"price" bigint,
	"stock" numeric(12, 3) DEFAULT 0 NOT NULL,
	"stock_label" varchar(20) DEFAULT 'pc' NOT NULL,
	"low_stock_threshold" numeric(12, 3) DEFAULT 5 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "items_unit_size_positive" CHECK ("items"."unit_size" > 0),
	CONSTRAINT "items_price_non_negative" CHECK ("items"."price" is null or "items"."price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"type" "ledger_type" NOT NULL,
	"amount" bigint NOT NULL,
	"balance_after" bigint NOT NULL,
	"bill_id" uuid,
	"method" "payment_method",
	"note" varchar(200),
	"client_id" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otp_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" varchar(16) NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbound_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"customer_id" uuid,
	"to_phone" varchar(16) NOT NULL,
	"type" "message_type" NOT NULL,
	"body" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "message_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"send_after" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"family_id" uuid NOT NULL,
	"device_name" varchar(120),
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"owner_name" varchar(120) NOT NULL,
	"city" varchar(80) NOT NULL,
	"state" varchar(60),
	"pincode" varchar(6),
	"gives_credit" boolean DEFAULT true NOT NULL,
	"gstin" varchar(15),
	"pan" varchar(10),
	"legal_name" varchar(160),
	"language" "store_language" DEFAULT 'hinglish' NOT NULL,
	"reply_style" "reply_style" DEFAULT 'voice_text' NOT NULL,
	"preferences_set_at" timestamp with time zone,
	"timezone" varchar(40) DEFAULT 'Asia/Kolkata' NOT NULL,
	"summary_time" varchar(5) DEFAULT '21:00' NOT NULL,
	"last_summary_date" date,
	"bill_counter" integer DEFAULT 0 NOT NULL,
	"onboarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" varchar(16) NOT NULL,
	"name" varchar(120),
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bill_items" ADD CONSTRAINT "bill_items_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_items" ADD CONSTRAINT "bill_items_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bill_items_bill_idx" ON "bill_items" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "bills_store_status_idx" ON "bills" USING btree ("store_id","status","confirmed_at");--> statement-breakpoint
CREATE INDEX "bills_customer_idx" ON "bills" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bills_store_number_unique" ON "bills" USING btree ("store_id","bill_number");--> statement-breakpoint
CREATE UNIQUE INDEX "bills_store_client_unique" ON "bills" USING btree ("store_id","client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bills_receipt_token_unique" ON "bills" USING btree ("receipt_token");--> statement-breakpoint
CREATE INDEX "customers_store_idx" ON "customers" USING btree ("store_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_store_phone_unique" ON "customers" USING btree ("store_id","phone");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_share_token_unique" ON "customers" USING btree ("share_token");--> statement-breakpoint
CREATE INDEX "items_store_idx" ON "items" USING btree ("store_id");--> statement-breakpoint
CREATE UNIQUE INDEX "items_store_variant_unique" ON "items" USING btree ("store_id","name_key","unit","unit_size");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_store_client_unique" ON "ledger_entries" USING btree ("store_id","client_id");--> statement-breakpoint
CREATE INDEX "ledger_customer_idx" ON "ledger_entries" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "ledger_store_idx" ON "ledger_entries" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "otp_codes_phone_idx" ON "otp_codes" USING btree ("phone","created_at");--> statement-breakpoint
CREATE INDEX "outbound_pending_idx" ON "outbound_messages" USING btree ("status","send_after");--> statement-breakpoint
CREATE UNIQUE INDEX "refresh_tokens_hash_unique" ON "refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_idx" ON "refresh_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stores_owner_unique" ON "stores" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_unique" ON "users" USING btree ("phone");