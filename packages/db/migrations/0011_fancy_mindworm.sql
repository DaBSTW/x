CREATE TABLE "trending_topics" (
	"id" bigint PRIMARY KEY NOT NULL,
	"scope" varchar(16) NOT NULL,
	"hashtag" varchar(300) NOT NULL,
	"score" double precision NOT NULL,
	"post_count_1h" integer NOT NULL,
	"unique_authors_1h" integer NOT NULL,
	"computed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_trending_topics_scope_score" ON "trending_topics" USING btree ("scope","score" DESC NULLS LAST);