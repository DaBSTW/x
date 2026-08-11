-- Hand-edited after `drizzle-kit generate`: converts `notifications` into a
-- range-partitioned table, same treatment as `posts` in migrations/0000
-- (drizzle-kit's DSL has no `PARTITION BY` construct). See
-- docs/adr/0002-migraciones.md and SPECS.md §14.1.
CREATE TYPE "public"."notification_kind" AS ENUM('like', 'repost', 'reply', 'quote', 'follow', 'mention', 'follow_request', 'system');--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"kind" "notification_kind" NOT NULL,
	"actor_id" bigint,
	"post_id" bigint,
	"group_key" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_id_created_at_pk" PRIMARY KEY("id","created_at")
) PARTITION BY RANGE ("created_at");
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_notifications_user" ON "notifications" USING btree ("user_id","id" DESC NULLS LAST);--> statement-breakpoint
-- Creates (idempotently) the monthly partition of `notifications` covering
-- `for_month` — same stand-in for pg_partman as `ensure_posts_partition`.
-- A scheduled job should call this 3 months ahead so writes never hit a
-- missing partition.
CREATE OR REPLACE FUNCTION ensure_notifications_partition(for_month date) RETURNS void AS $$
DECLARE
  partition_name text := 'notifications_' || to_char(for_month, 'YYYY_MM');
  range_start date := date_trunc('month', for_month);
  range_end date := range_start + interval '1 month';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = partition_name) THEN
    EXECUTE format(
      'CREATE TABLE %I PARTITION OF notifications FOR VALUES FROM (%L) TO (%L)',
      partition_name, range_start, range_end
    );
  END IF;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
SELECT ensure_notifications_partition((date_trunc('month', now()) + (n || ' month')::interval)::date)
FROM generate_series(0, 3) AS n;
