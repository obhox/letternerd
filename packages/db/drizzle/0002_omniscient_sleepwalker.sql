CREATE TYPE "public"."analytics_provider" AS ENUM('search_console', 'falorb');--> statement-breakpoint
CREATE TABLE "site_analytics_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"provider" "analytics_provider" NOT NULL,
	"access_token_encrypted" text,
	"refresh_token_encrypted" text,
	"access_token_expires_at" timestamp with time zone,
	"property_url" text NOT NULL,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"connected_by_user_id" text,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "site_analytics_connections" ADD CONSTRAINT "site_analytics_connections_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_analytics_connections" ADD CONSTRAINT "site_analytics_connections_connected_by_user_id_user_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "site_analytics_connections_site_provider_uq" ON "site_analytics_connections" USING btree ("site_id","provider");