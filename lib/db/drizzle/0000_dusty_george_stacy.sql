CREATE TABLE "listings" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"price" numeric NOT NULL,
	"city" text NOT NULL,
	"condition" text NOT NULL,
	"contact_name" text NOT NULL,
	"contact_phone" text,
	"image_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "boat_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"parent_id" integer,
	"slug" text NOT NULL,
	"name_ru" text NOT NULL,
	"name_en" text,
	"description_ru" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "boat_listings" (
	"id" serial PRIMARY KEY NOT NULL,
	"category_id" integer NOT NULL,
	"slug" text,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"price" numeric(12, 2),
	"currency" text DEFAULT 'RUB' NOT NULL,
	"is_negotiable" boolean DEFAULT false NOT NULL,
	"price_unit" text DEFAULT 'total' NOT NULL,
	"transaction_type" text DEFAULT 'sale' NOT NULL,
	"year" integer,
	"length_m" numeric(7, 2),
	"width_m" numeric(7, 2),
	"manufacturer" text,
	"model" text,
	"engine_type" text,
	"engine_power_hp" integer,
	"engine_hours" numeric(10, 1),
	"condition" text NOT NULL,
	"country" text NOT NULL,
	"city_or_region" text NOT NULL,
	"water_area" text,
	"contact_name" text NOT NULL,
	"contact_phone" text NOT NULL,
	"telegram" text,
	"whatsapp" text,
	"email" text,
	"public_email" text,
	"max_contact" text,
	"author_clerk_user_id" text,
	"author_password_hash" text NOT NULL,
	"submission_ip_hash" text,
	"status" text DEFAULT 'active' NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"is_featured" boolean DEFAULT false NOT NULL,
	"featured_until" timestamp with time zone,
	"boosted_at" timestamp with time zone,
	"boosted_until" timestamp with time zone,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"pinned_until" timestamp with time zone,
	"reminder_sent_at" timestamp with time zone,
	"reminder_claimed_at" timestamp with time zone,
	"priority" integer DEFAULT 0 NOT NULL,
	"paid_status" text DEFAULT 'free' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "listing_photos" (
	"id" serial PRIMARY KEY NOT NULL,
	"listing_id" integer NOT NULL,
	"object_key" text NOT NULL,
	"thumbnail_key" text,
	"alt_text" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listing_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"listing_id" integer NOT NULL,
	"reporter_name" text,
	"reporter_contact" text,
	"reason" text NOT NULL,
	"details" text,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "site_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listing_captcha_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"question" text NOT NULL,
	"answer_hash" text NOT NULL,
	"ip_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pending_listing_uploads" (
	"id" serial PRIMARY KEY NOT NULL,
	"object_path" text NOT NULL,
	"draft_token_hash" text NOT NULL,
	"ip_hash" text NOT NULL,
	"original_name" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pending_listing_uploads_object_path_unique" UNIQUE("object_path")
);
--> statement-breakpoint
CREATE TABLE "listing_author_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"listing_id" integer NOT NULL,
	"ip_hash" text NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listing_password_reset_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"listing_id" integer NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listing_view_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"listing_id" integer NOT NULL,
	"viewer_hash" text NOT NULL,
	"view_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listing_rate_limit_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"ip_hash" text NOT NULL,
	"listing_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forum_posts" (
	"id" serial PRIMARY KEY NOT NULL,
	"topic_id" integer NOT NULL,
	"author_id" integer NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'visible' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	CONSTRAINT "forum_posts_status_check" CHECK ("forum_posts"."status" in ('visible', 'hidden', 'deleted')),
	CONSTRAINT "forum_posts_body_length_check" CHECK (length("forum_posts"."body") between 1 and 6000)
);
--> statement-breakpoint
CREATE TABLE "forum_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"post_id" integer NOT NULL,
	"reporter_id" integer NOT NULL,
	"reason" text NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL,
	"resolved_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "forum_section_bans" (
	"id" serial PRIMARY KEY NOT NULL,
	"section_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"banned_by" integer,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "forum_sections" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"site_section_id" integer,
	"censored" boolean DEFAULT true NOT NULL,
	"rate_limit_sec" integer DEFAULT 10 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "forum_sections_kind_check" CHECK ("forum_sections"."kind" in ('listing', 'general', 'offtopic', 'flood')),
	CONSTRAINT "forum_sections_rate_limit_check" CHECK ("forum_sections"."rate_limit_sec" >= 0)
);
--> statement-breakpoint
CREATE TABLE "forum_topics" (
	"id" serial PRIMARY KEY NOT NULL,
	"section_id" integer NOT NULL,
	"listing_id" integer,
	"author_id" integer NOT NULL,
	"title" text NOT NULL,
	"is_locked" boolean DEFAULT false NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "forum_topics_title_length_check" CHECK (length("forum_topics"."title") between 1 and 160)
);
--> statement-breakpoint
CREATE TABLE "forum_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"clerk_user_id" text NOT NULL,
	"display_name" text DEFAULT 'Участник' NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "forum_users_role_check" CHECK ("forum_users"."role" in ('user', 'moderator', 'admin'))
);
--> statement-breakpoint
CREATE TABLE "admin_audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor" text DEFAULT 'site-admin' NOT NULL,
	"action" text NOT NULL,
	"target_user_id" integer,
	"previous_value" text NOT NULL,
	"next_value" text NOT NULL,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_audit_logs_action_check" CHECK ("admin_audit_logs"."action" in ('forum_role_changed', 'account_access_changed'))
);
--> statement-breakpoint
ALTER TABLE "boat_categories" ADD CONSTRAINT "boat_categories_parent_id_boat_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."boat_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boat_listings" ADD CONSTRAINT "boat_listings_category_id_boat_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."boat_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_photos" ADD CONSTRAINT "listing_photos_listing_id_boat_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."boat_listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_reports" ADD CONSTRAINT "listing_reports_listing_id_boat_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."boat_listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_author_attempts" ADD CONSTRAINT "listing_author_attempts_listing_id_boat_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."boat_listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_password_reset_tokens" ADD CONSTRAINT "listing_password_reset_tokens_listing_id_boat_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."boat_listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_view_events" ADD CONSTRAINT "listing_view_events_listing_id_boat_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."boat_listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_posts" ADD CONSTRAINT "forum_posts_topic_id_forum_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."forum_topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_posts" ADD CONSTRAINT "forum_posts_author_id_forum_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."forum_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_reports" ADD CONSTRAINT "forum_reports_post_id_forum_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."forum_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_reports" ADD CONSTRAINT "forum_reports_reporter_id_forum_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."forum_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_reports" ADD CONSTRAINT "forum_reports_resolved_by_forum_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."forum_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_section_bans" ADD CONSTRAINT "forum_section_bans_section_id_forum_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."forum_sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_section_bans" ADD CONSTRAINT "forum_section_bans_user_id_forum_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."forum_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_section_bans" ADD CONSTRAINT "forum_section_bans_banned_by_forum_users_id_fk" FOREIGN KEY ("banned_by") REFERENCES "public"."forum_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_sections" ADD CONSTRAINT "forum_sections_site_section_id_boat_categories_id_fk" FOREIGN KEY ("site_section_id") REFERENCES "public"."boat_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_topics" ADD CONSTRAINT "forum_topics_section_id_forum_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."forum_sections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_topics" ADD CONSTRAINT "forum_topics_listing_id_boat_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."boat_listings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_topics" ADD CONSTRAINT "forum_topics_author_id_forum_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."forum_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_target_user_id_forum_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."forum_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "boat_categories_slug_unique" ON "boat_categories" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "boat_categories_parent_order_idx" ON "boat_categories" USING btree ("parent_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "boat_listings_slug_unique" ON "boat_listings" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "boat_listings_category_status_created_idx" ON "boat_listings" USING btree ("category_id","status","created_at");--> statement-breakpoint
CREATE INDEX "boat_listings_featured_priority_idx" ON "boat_listings" USING btree ("is_featured","priority");--> statement-breakpoint
CREATE INDEX "boat_listings_author_clerk_user_id_idx" ON "boat_listings" USING btree ("author_clerk_user_id");--> statement-breakpoint
CREATE INDEX "boat_listings_ip_created_idx" ON "boat_listings" USING btree ("submission_ip_hash","created_at");--> statement-breakpoint
CREATE INDEX "listing_photos_listing_order_idx" ON "listing_photos" USING btree ("listing_id","sort_order");--> statement-breakpoint
CREATE INDEX "listing_reports_status_created_idx" ON "listing_reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "listing_captcha_challenges_expiry_idx" ON "listing_captcha_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "pending_listing_uploads_draft_expiry_idx" ON "pending_listing_uploads" USING btree ("draft_token_hash","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "listing_author_attempts_listing_ip_unique" ON "listing_author_attempts" USING btree ("listing_id","ip_hash");--> statement-breakpoint
CREATE INDEX "listing_author_attempts_lock_idx" ON "listing_author_attempts" USING btree ("locked_until");--> statement-breakpoint
CREATE UNIQUE INDEX "listing_password_reset_token_unique" ON "listing_password_reset_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "listing_password_reset_expiry_idx" ON "listing_password_reset_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "listing_view_events_daily_unique" ON "listing_view_events" USING btree ("listing_id","viewer_hash","view_date");--> statement-breakpoint
CREATE INDEX "listing_view_events_created_idx" ON "listing_view_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "listing_rate_limit_action_ip_created_idx" ON "listing_rate_limit_events" USING btree ("action","ip_hash","created_at");--> statement-breakpoint
CREATE INDEX "forum_posts_topic_order_idx" ON "forum_posts" USING btree ("topic_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "forum_reports_post_reporter_uq" ON "forum_reports" USING btree ("post_id","reporter_id");--> statement-breakpoint
CREATE INDEX "forum_reports_queue_idx" ON "forum_reports" USING btree ("resolved","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "forum_section_bans_section_user_uq" ON "forum_section_bans" USING btree ("section_id","user_id");--> statement-breakpoint
CREATE INDEX "forum_section_bans_user_idx" ON "forum_section_bans" USING btree ("user_id","section_id");--> statement-breakpoint
CREATE UNIQUE INDEX "forum_sections_slug_uq" ON "forum_sections" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "forum_sections_site_section_uq" ON "forum_sections" USING btree ("site_section_id") WHERE "forum_sections"."site_section_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "forum_topics_listing_uq" ON "forum_topics" USING btree ("listing_id") WHERE "forum_topics"."listing_id" is not null;--> statement-breakpoint
CREATE INDEX "forum_topics_section_order_idx" ON "forum_topics" USING btree ("section_id","is_pinned","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "forum_users_clerk_user_id_uq" ON "forum_users" USING btree ("clerk_user_id");--> statement-breakpoint
CREATE INDEX "admin_audit_logs_target_created_idx" ON "admin_audit_logs" USING btree ("target_user_id","created_at");