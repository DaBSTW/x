CREATE TABLE "follow_requests" (
	"requester_id" bigint NOT NULL,
	"target_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "follow_requests_requester_id_target_id_pk" PRIMARY KEY("requester_id","target_id"),
	CONSTRAINT "no_self_follow_request" CHECK ("follow_requests"."requester_id" <> "follow_requests"."target_id")
);
--> statement-breakpoint
ALTER TABLE "follow_requests" ADD CONSTRAINT "follow_requests_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_requests" ADD CONSTRAINT "follow_requests_target_id_users_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_follow_requests_target" ON "follow_requests" USING btree ("target_id","created_at" DESC NULLS LAST);