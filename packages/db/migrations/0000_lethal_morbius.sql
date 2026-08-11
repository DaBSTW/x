-- Hand-edited after `drizzle-kit generate`: adds the citext extension, and
-- converts `posts` into a range-partitioned table (drizzle-kit's DSL has no
-- `PARTITION BY` construct). See docs/adr/0002-migraciones.md.
CREATE EXTENSION IF NOT EXISTS citext;--> statement-breakpoint
CREATE TYPE "public"."post_kind" AS ENUM('original', 'reply', 'repost', 'quote');--> statement-breakpoint
CREATE TABLE "email_verification_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" bigint PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"session_id" bigint NOT NULL,
	"token_hash" text NOT NULL,
	"replaced_by_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"user_agent" text,
	"ip_address" text,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "post_counters" (
	"post_id" bigint PRIMARY KEY NOT NULL,
	"likes_count" integer DEFAULT 0 NOT NULL,
	"reposts_count" integer DEFAULT 0 NOT NULL,
	"replies_count" integer DEFAULT 0 NOT NULL,
	"quotes_count" integer DEFAULT 0 NOT NULL,
	"bookmark_count" integer DEFAULT 0 NOT NULL,
	"views_count" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_entities" (
	"post_id" bigint NOT NULL,
	"kind" smallint NOT NULL,
	"value" varchar(300) NOT NULL,
	"start_index" smallint NOT NULL,
	"end_index" smallint NOT NULL,
	"ref_id" bigint,
	CONSTRAINT "post_entities_post_id_start_index_pk" PRIMARY KEY("post_id","start_index")
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" bigint NOT NULL,
	"author_id" bigint NOT NULL,
	"kind" "post_kind" DEFAULT 'original' NOT NULL,
	"text" varchar(280),
	"lang" varchar(8),
	"in_reply_to_id" bigint,
	"conversation_id" bigint,
	"repost_of_id" bigint,
	"quoted_post_id" bigint,
	"reply_policy" smallint DEFAULT 0 NOT NULL,
	"is_sensitive" boolean DEFAULT false NOT NULL,
	"client_name" varchar(50),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "posts_id_created_at_pk" PRIMARY KEY("id","created_at")
) PARTITION BY RANGE ("created_at");
--> statement-breakpoint
-- Creates (idempotently) the monthly partition of `posts` covering `for_month`.
-- Stands in for pg_partman (ROADMAP.md 0.2 marks it deferrable): a scheduled
-- job should call this 3 months ahead of the current date so writes never hit
-- a missing partition. See docs/adr/0002-migraciones.md.
CREATE OR REPLACE FUNCTION ensure_posts_partition(for_month date) RETURNS void AS $$
DECLARE
  partition_name text := 'posts_' || to_char(for_month, 'YYYY_MM');
  range_start date := date_trunc('month', for_month);
  range_end date := range_start + interval '1 month';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = partition_name) THEN
    EXECUTE format(
      'CREATE TABLE %I PARTITION OF posts FOR VALUES FROM (%L) TO (%L)',
      partition_name, range_start, range_end
    );
  END IF;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
-- Current month plus three months of lead time, matching the roadmap's rule.
SELECT ensure_posts_partition((date_trunc('month', now()) + (n || ' month')::interval)::date)
FROM generate_series(0, 3) AS n;
--> statement-breakpoint
CREATE TABLE "follows" (
	"follower_id" bigint NOT NULL,
	"followee_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "follows_follower_id_followee_id_pk" PRIMARY KEY("follower_id","followee_id"),
	CONSTRAINT "no_self_follow" CHECK ("follows"."follower_id" <> "follows"."followee_id")
);
--> statement-breakpoint
CREATE TABLE "user_counters" (
	"user_id" bigint PRIMARY KEY NOT NULL,
	"followers_count" integer DEFAULT 0 NOT NULL,
	"following_count" integer DEFAULT 0 NOT NULL,
	"posts_count" integer DEFAULT 0 NOT NULL,
	"likes_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" bigint PRIMARY KEY NOT NULL,
	"username" varchar(15) NOT NULL,
	"username_lower" varchar(15) NOT NULL,
	"email" "citext" NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"password_hash" text,
	"display_name" varchar(50) NOT NULL,
	"bio" varchar(160),
	"location" varchar(30),
	"website_url" text,
	"avatar_url" text,
	"banner_url" text,
	"birth_date" date,
	"is_protected" boolean DEFAULT false NOT NULL,
	"is_verified" boolean DEFAULT false NOT NULL,
	"is_suspended" boolean DEFAULT false NOT NULL,
	"lang" varchar(8) DEFAULT 'es' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_username_lower_unique" UNIQUE("username_lower"),
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "username_format" CHECK ("users"."username" ~ '^[A-Za-z0-9_]{1,15}$')
);
--> statement-breakpoint
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_follower_id_users_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_followee_id_users_id_fk" FOREIGN KEY ("followee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_counters" ADD CONSTRAINT "user_counters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_refresh_tokens_user" ON "refresh_tokens" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_refresh_tokens_session" ON "refresh_tokens" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_entities_value" ON "post_entities" USING btree ("kind","value","post_id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_posts_author" ON "posts" USING btree ("author_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_posts_conversation" ON "posts" USING btree ("conversation_id","created_at") WHERE "posts"."kind" = 'reply';--> statement-breakpoint
CREATE INDEX "idx_posts_quoted" ON "posts" USING btree ("quoted_post_id") WHERE "posts"."quoted_post_id" is not null;--> statement-breakpoint
CREATE INDEX "idx_follows_followee" ON "follows" USING btree ("followee_id","created_at" DESC NULLS LAST);