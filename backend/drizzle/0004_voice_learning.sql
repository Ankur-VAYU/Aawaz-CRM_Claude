CREATE TYPE "public"."voice_outcome" AS ENUM('not_understood', 'needs_input', 'corrected');--> statement-breakpoint
CREATE TABLE "voice_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"text" text NOT NULL,
	"source" varchar(10),
	"language" varchar(10),
	"intent" varchar(30),
	"outcome" "voice_outcome" NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "aliases" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "voice_log_opt_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "voice_events" ADD CONSTRAINT "voice_events_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "voice_events_store_idx" ON "voice_events" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "voice_events_created_idx" ON "voice_events" USING btree ("created_at");