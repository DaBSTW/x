CREATE TYPE "public"."media_kind" AS ENUM('image', 'gif', 'video');--> statement-breakpoint
CREATE TABLE "media" (
	"id" bigint PRIMARY KEY NOT NULL,
	"owner_id" bigint NOT NULL,
	"post_id" bigint,
	"kind" "media_kind" DEFAULT 'image' NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"width" integer,
	"height" integer,
	"duration_ms" integer,
	"size_bytes" bigint NOT NULL,
	"blurhash" text,
	"alt_text" varchar(1000),
	"variants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_media_post" ON "media" USING btree ("post_id") WHERE "media"."post_id" is not null;