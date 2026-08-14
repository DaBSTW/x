CREATE TYPE "public"."moderation_action_type" AS ENUM('label', 'reduce_reach', 'hide', 'delete', 'read_only', 'suspend', 'ban');--> statement-breakpoint
CREATE TYPE "public"."moderation_actor_type" AS ENUM('system', 'moderator');--> statement-breakpoint
CREATE TYPE "public"."moderation_appeal_status" AS ENUM('pending', 'upheld', 'overturned');--> statement-breakpoint
CREATE TYPE "public"."moderation_target_type" AS ENUM('post', 'user');--> statement-breakpoint
CREATE TYPE "public"."report_category" AS ENUM('spam', 'harassment', 'hate_speech', 'violence', 'nsfw', 'misinformation', 'self_harm', 'other');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('pending', 'reviewing', 'actioned', 'dismissed');--> statement-breakpoint
CREATE TABLE "moderation_actions" (
	"id" bigint PRIMARY KEY NOT NULL,
	"target_type" "moderation_target_type" NOT NULL,
	"target_id" bigint NOT NULL,
	"action" "moderation_action_type" NOT NULL,
	"reason" varchar(500) NOT NULL,
	"policy" varchar(100) NOT NULL,
	"actor_type" "moderation_actor_type" NOT NULL,
	"actor_id" bigint,
	"report_id" bigint,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "moderation_appeals" (
	"id" bigint PRIMARY KEY NOT NULL,
	"moderation_action_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"status" "moderation_appeal_status" DEFAULT 'pending' NOT NULL,
	"user_statement" varchar(1000),
	"resolved_by" bigint,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_moderation_appeals_action" UNIQUE("moderation_action_id")
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" bigint PRIMARY KEY NOT NULL,
	"reporter_id" bigint NOT NULL,
	"target_type" "moderation_target_type" NOT NULL,
	"target_id" bigint NOT NULL,
	"category" "report_category" NOT NULL,
	"reason" varchar(500),
	"status" "report_status" DEFAULT 'pending' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" bigint
);
--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "moderator_label" varchar(100);--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "reduced_reach" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "moderator_hidden_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "read_only_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_banned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_moderator" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_appeals" ADD CONSTRAINT "moderation_appeals_moderation_action_id_moderation_actions_id_fk" FOREIGN KEY ("moderation_action_id") REFERENCES "public"."moderation_actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_appeals" ADD CONSTRAINT "moderation_appeals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_appeals" ADD CONSTRAINT "moderation_appeals_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_moderation_actions_target" ON "moderation_actions" USING btree ("target_type","target_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_moderation_actions_created" ON "moderation_actions" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_moderation_appeals_status" ON "moderation_appeals" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "idx_moderation_appeals_user" ON "moderation_appeals" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_reports_queue" ON "reports" USING btree ("status","priority" DESC NULLS LAST,"created_at");--> statement-breakpoint
CREATE INDEX "idx_reports_target" ON "reports" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "idx_reports_reporter" ON "reports" USING btree ("reporter_id","created_at" DESC NULLS LAST);