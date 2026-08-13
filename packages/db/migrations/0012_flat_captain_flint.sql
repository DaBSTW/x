CREATE TABLE "known_content_hashes" (
	"sha256" varchar(64) PRIMARY KEY NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text
);
