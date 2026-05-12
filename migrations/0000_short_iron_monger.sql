CREATE TABLE "account_contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"contact_id" integer NOT NULL,
	"role" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"website" text,
	"address" text,
	"marina_type" text,
	"ownership_type" text,
	"parent_company" text,
	"street_address" text,
	"city" text,
	"state_province" text,
	"postal_zip" text,
	"country" text,
	"region" text,
	"timezone" text,
	"latitude" double precision,
	"longitude" double precision,
	"slip_count" integer,
	"segment" text DEFAULT 'marina' NOT NULL,
	"slip_mix" text,
	"avg_boat_size_range" text,
	"power_demand_intensity" text,
	"seasonality" text,
	"expansion_plans" boolean DEFAULT false,
	"expansion_notes" text,
	"lead_source" text,
	"lead_status" text DEFAULT 'new' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"assigned_to_user_id" integer,
	"beta_tester" boolean DEFAULT false,
	"pilot_candidate_score" integer,
	"red_flags" text,
	"last_interaction_at" timestamp,
	"next_action" text,
	"next_action_at" timestamp,
	"next_action_owner_user_id" integer,
	"notes_summary" text,
	"tags" text,
	"notes" text,
	"org_type" text DEFAULT 'marina_prospect',
	"partner_class" text,
	"influence_score" integer,
	"strategic_importance" text,
	"priority_level" text,
	"membership_status" text,
	"marinas_represented" integer,
	"partner_metadata" jsonb,
	"converted_from_lead_id" integer,
	"converted_from_partnership_id" integer,
	"acquisition_channel" text,
	"original_source" text,
	"source_captured_at" timestamp,
	"territory_id" integer,
	"total_slips" integer,
	"voltsafe_slips_live" integer,
	"non_voltsafe_slips_on_software" integer,
	"future_upgrade_slips" integer,
	"contracted_units" integer,
	"installed_units" integer,
	"remaining_units" integer,
	"contracted_hardware_value" numeric(14, 2),
	"booked_hardware_value" numeric(14, 2),
	"delivered_hardware_value" numeric(14, 2),
	"rollout_start_date" date,
	"rollout_end_target" date,
	"pricing_lock_date" date,
	"pricing_lock_expiry" date,
	"commercial_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activities" (
	"id" serial PRIMARY KEY NOT NULL,
	"linked_object_type" text NOT NULL,
	"linked_object_id" integer NOT NULL,
	"type" text NOT NULL,
	"subject" text,
	"summary" text NOT NULL,
	"outcome" text,
	"attendees" text,
	"raw_content" text,
	"contact_id" integer,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"gmail_thread_id" text,
	"gmail_message_id" text
);
--> statement-breakpoint
CREATE TABLE "asset_folders" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"parent_folder_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"original_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"file_path" text DEFAULT '' NOT NULL,
	"file_data" text,
	"category" text DEFAULT 'general' NOT NULL,
	"description" text,
	"tags" text DEFAULT '',
	"folder_id" integer,
	"uploaded_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "association_feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"email_message_id" integer NOT NULL,
	"original_object_type" text,
	"original_object_id" integer,
	"corrected_object_type" text,
	"corrected_object_id" integer,
	"feedback_type" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"object_type" text NOT NULL,
	"object_id" integer NOT NULL,
	"file_name" text NOT NULL,
	"original_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"file_size" integer NOT NULL,
	"uploaded_by" integer,
	"uploaded_by_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"title" text,
	"category" text DEFAULT 'general',
	"notes" text,
	"tags" text[],
	"source" text DEFAULT 'upload',
	"url" text
);
--> statement-breakpoint
CREATE TABLE "automation_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"trigger_type" text NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scope" text DEFAULT 'global' NOT NULL,
	"cooldown_minutes" integer DEFAULT 0 NOT NULL,
	"dedupe_key" text,
	"is_template" boolean DEFAULT false NOT NULL,
	"template_name" text,
	"created_by" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"last_run_at" timestamp,
	"last_result" text,
	"run_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_run_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"rule_id" integer NOT NULL,
	"trigger_data" jsonb,
	"actions_result" jsonb,
	"status" text DEFAULT 'success' NOT NULL,
	"error_message" text,
	"dry_run" boolean DEFAULT false NOT NULL,
	"actions_taken" integer DEFAULT 0 NOT NULL,
	"executed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "board_pack_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"schedule_id" integer,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	"delivered_at" timestamp,
	"status" text DEFAULT 'pending' NOT NULL,
	"report_type" text,
	"output_types" jsonb DEFAULT '["html"]'::jsonb NOT NULL,
	"recipient_count" integer DEFAULT 0 NOT NULL,
	"payload_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"errors" text,
	"triggered_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "board_pack_schedules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"schedule_type" text DEFAULT 'monthly' NOT NULL,
	"weekday" integer,
	"day_of_month" integer,
	"month_in_quarter" integer,
	"send_hour" integer DEFAULT 8 NOT NULL,
	"timezone" text DEFAULT 'America/Vancouver' NOT NULL,
	"report_type" text DEFAULT 'board_pack' NOT NULL,
	"preset_id" integer,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"included_sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recipients" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"delivery_channels" jsonb DEFAULT '["email","in_app"]'::jsonb NOT NULL,
	"last_run_at" timestamp,
	"next_run_at" timestamp,
	"last_status" text,
	"last_error" text,
	"created_by" integer NOT NULL,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_link_recipients" (
	"id" serial PRIMARY KEY NOT NULL,
	"booking_link_id" integer NOT NULL,
	"recipient_email" text NOT NULL,
	"token" text NOT NULL,
	"sent_at" timestamp,
	"first_viewed_at" timestamp,
	"view_count" integer DEFAULT 0 NOT NULL,
	"booked_calendar_event_id" integer,
	"booked_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_user_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"slug" text NOT NULL,
	"slot_minutes" integer DEFAULT 30 NOT NULL,
	"buffer_minutes" integer DEFAULT 0 NOT NULL,
	"advance_days" integer DEFAULT 14 NOT NULL,
	"min_notice_hours" integer DEFAULT 4 NOT NULL,
	"time_zone" text DEFAULT 'America/Los_Angeles' NOT NULL,
	"availability" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"location_type" text DEFAULT 'zoom' NOT NULL,
	"location_value" text,
	"require_recipient_match" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_connections" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"provider" text NOT NULL,
	"account_email" text,
	"display_name" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"token_expires_at" timestamp,
	"caldav_url" text,
	"caldav_username" text,
	"caldav_password" text,
	"default_calendar_id" text,
	"default_calendar_name" text,
	"sync_enabled" boolean DEFAULT true NOT NULL,
	"sync_direction" text DEFAULT 'both',
	"sync_frequency_minutes" integer DEFAULT 15,
	"conflict_resolution" text DEFAULT 'latest_wins',
	"calendars_discovered" jsonb,
	"last_synced_at" timestamp,
	"sync_token" text,
	"sync_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"event_type" text DEFAULT 'meeting' NOT NULL,
	"start_time" timestamp NOT NULL,
	"end_time" timestamp,
	"all_day" boolean DEFAULT false,
	"location" text,
	"meeting_url" text,
	"linked_object_type" text,
	"linked_object_id" integer,
	"color" text,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"invitees" text[],
	"time_zone" text,
	"repeat" text DEFAULT 'none',
	"travel_time" text DEFAULT 'none',
	"alert" text DEFAULT 'none',
	"second_alert" text DEFAULT 'none',
	"show_as" text DEFAULT 'busy',
	"visibility" text DEFAULT 'default',
	"external_id" text,
	"external_etag" text,
	"external_provider" text,
	"external_calendar_id" text,
	"booking_link_recipient_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_drafts" (
	"id" serial PRIMARY KEY NOT NULL,
	"subject" text NOT NULL,
	"body_html" text,
	"body_text" text,
	"list_ids" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"external_campaign_id" text,
	"external_campaign_link" text,
	"sent_at" timestamp,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chart_data" (
	"id" serial PRIMARY KEY NOT NULL,
	"month" text NOT NULL,
	"revenue" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"object_type" text NOT NULL,
	"object_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"user_name" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commissioning_checkpoints" (
	"id" serial PRIMARY KEY NOT NULL,
	"deployment_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sequence_order" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"checked_by_user_id" integer,
	"checked_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "communication_lists" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"external_id" text,
	"description" text,
	"member_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"name" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"title" text,
	"email" text,
	"phone" text,
	"persona" text,
	"role_type" text,
	"preferred_contact_method" text,
	"linkedin_url" text,
	"relationship_strength" text,
	"is_primary" boolean DEFAULT false,
	"notes" text,
	"avatar_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"deployment_id" integer,
	"install_workflow_id" integer,
	"opportunity_id" integer,
	"owner_user_id" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"go_live_date" timestamp,
	"subscription_start" timestamp,
	"subscription_end" timestamp,
	"renewal_date" timestamp,
	"contract_term_months" integer DEFAULT 12,
	"mrr" real DEFAULT 0,
	"arr" real DEFAULT 0,
	"billing_status" text DEFAULT 'current',
	"health_score" integer DEFAULT 100,
	"health_status" text DEFAULT 'healthy',
	"churn_risk_flags" jsonb,
	"expansion_potential" text DEFAULT 'none',
	"expansion_notes" text,
	"expansion_opportunity_id" integer,
	"last_checkin_at" timestamp,
	"renewal_task_created" boolean DEFAULT false,
	"notes" text,
	"tags" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_quality_ignores" (
	"id" serial PRIMARY KEY NOT NULL,
	"object_type" text NOT NULL,
	"object_id" integer,
	"cluster_key" text,
	"issue_type" text NOT NULL,
	"ignored_by" integer,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deal_stage_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"deal_id" integer NOT NULL,
	"from_stage" text,
	"to_stage" text NOT NULL,
	"changed_by_user_id" integer,
	"changed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployment_blockers" (
	"id" serial PRIMARY KEY NOT NULL,
	"deployment_id" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"severity" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_at" timestamp,
	"resolved_by_user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployment_hardware_allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"deployment_id" integer NOT NULL,
	"part_id" integer,
	"inventory_allocation_id" integer,
	"description" text,
	"quantity_required" real DEFAULT 1 NOT NULL,
	"quantity_reserved" real DEFAULT 0 NOT NULL,
	"quantity_shipped" real DEFAULT 0 NOT NULL,
	"quantity_delivered" real DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployments" (
	"id" serial PRIMARY KEY NOT NULL,
	"deploy_number" text NOT NULL,
	"site_name" text NOT NULL,
	"address" text,
	"region" text,
	"account_id" integer,
	"install_workflow_id" integer,
	"opportunity_id" integer,
	"owner_user_id" integer,
	"status" text DEFAULT 'planned' NOT NULL,
	"planned_start" timestamp,
	"actual_start" timestamp,
	"target_go_live" timestamp,
	"actual_go_live" timestamp,
	"docks_count" integer,
	"units_count" integer,
	"notes" text,
	"blockers" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "digest_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"cadence" text DEFAULT 'daily' NOT NULL,
	"send_hour" integer DEFAULT 8 NOT NULL,
	"send_day_of_week" integer DEFAULT 1 NOT NULL,
	"channels" jsonb DEFAULT '["in_app"]'::jsonb NOT NULL,
	"sections" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"severity_threshold" text DEFAULT 'medium' NOT NULL,
	"is_role_default" boolean DEFAULT true NOT NULL,
	"quiet_hours_start" integer DEFAULT 21 NOT NULL,
	"quiet_hours_end" integer DEFAULT 7 NOT NULL,
	"alert_rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "digest_configs_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "digest_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"digest_type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"channel" text DEFAULT 'in_app' NOT NULL,
	"sections_sent" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"payload_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_message" text,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	"delivered_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ecosystem_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"organizer" text,
	"location" text,
	"event_date" timestamp,
	"industry_category" text,
	"voltsafe_participation" text,
	"key_contacts_met" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ecosystem_organizations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"organization_type" text,
	"region" text,
	"country" text,
	"website" text,
	"marinas_or_locations" integer,
	"total_slip_count" integer,
	"strategic_tier" text,
	"influence_score" integer,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ecosystem_people" (
	"id" serial PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"title" text,
	"organization_id" integer,
	"organization_name" text,
	"role_type" text,
	"linkedin_profile" text,
	"email" text,
	"phone" text,
	"influence_score" integer,
	"relationship_strength" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ecosystem_regions" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"country" text,
	"state_province" text,
	"number_of_marinas" integer,
	"electrical_code_version" text,
	"regulatory_notes" text,
	"strategic_importance" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ecosystem_relationships" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_entity_type" text NOT NULL,
	"source_entity_id" integer NOT NULL,
	"source_entity_name" text,
	"target_entity_type" text NOT NULL,
	"target_entity_id" integer NOT NULL,
	"target_entity_name" text,
	"relationship_type" text,
	"start_date" timestamp,
	"strategic_importance" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer DEFAULT 1 NOT NULL,
	"user_id" integer NOT NULL,
	"provider" text DEFAULT 'gmail' NOT NULL,
	"email_address" text NOT NULL,
	"display_name" text,
	"auth_status" text DEFAULT 'active' NOT NULL,
	"is_active" boolean DEFAULT true,
	"is_shared" boolean DEFAULT false,
	"scopes_json" text,
	"refresh_token" text,
	"access_token" text,
	"sync_enabled" boolean DEFAULT true NOT NULL,
	"last_sync_at" timestamp,
	"last_history_id" text,
	"sync_error_message" text,
	"disconnected_at" timestamp,
	"watch_expiration_at" timestamp,
	"watch_history_id" text,
	"watch_topic" text,
	"last_webhook_at" timestamp,
	"last_incremental_sync_at" timestamp,
	"incremental_event_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_associations" (
	"id" serial PRIMARY KEY NOT NULL,
	"email_message_id" integer NOT NULL,
	"object_type" text NOT NULL,
	"object_id" integer NOT NULL,
	"object_name" text,
	"confidence_score" integer DEFAULT 0,
	"association_reason_json" text,
	"is_auto" boolean DEFAULT true,
	"is_user_confirmed" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"message_id" integer NOT NULL,
	"gmail_attachment_id" text,
	"filename" text,
	"mime_type" text,
	"size_bytes" integer DEFAULT 0,
	"content_id" text,
	"is_inline" boolean DEFAULT false,
	"part_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_engagement_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"tracking_id" text NOT NULL,
	"event_type" text NOT NULL,
	"url" text,
	"ip_hash" text,
	"user_agent" text,
	"is_bot" boolean DEFAULT false NOT NULL,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"timeline_created" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_engagement_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"trigger_type" text NOT NULL,
	"min_events" integer DEFAULT 1 NOT NULL,
	"action_type" text NOT NULL,
	"action_config" jsonb,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_filters" (
	"id" serial PRIMARY KEY NOT NULL,
	"domain" text NOT NULL,
	"added_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "email_filters_domain_unique" UNIQUE("domain")
);
--> statement-breakpoint
CREATE TABLE "email_folder_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer DEFAULT 1 NOT NULL,
	"email_id" integer NOT NULL,
	"folder_id" integer NOT NULL,
	"owner_user_id" integer NOT NULL,
	"assigned_by" text DEFAULT 'system' NOT NULL,
	"assignment_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"gmail_message_id" text NOT NULL,
	"gmail_thread_id" text NOT NULL,
	"subject" text,
	"normalized_subject" text,
	"from_email" text,
	"from_name" text,
	"to_emails" text,
	"cc_emails" text,
	"all_participants" text,
	"sent_at" timestamp,
	"body_text" text,
	"body_html" text,
	"direction" text DEFAULT 'inbound',
	"from_domain" text,
	"has_attachments" boolean DEFAULT false,
	"is_reply" boolean DEFAULT false,
	"unsubscribe_detected" boolean DEFAULT false,
	"auto_generated_score" integer DEFAULT 0,
	"bulk_email_score" integer DEFAULT 0,
	"ignored_reason" text,
	"label_ids" text,
	"snippet" text,
	"owner_user_id" integer,
	"source_account_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "email_messages_gmail_message_id_unique" UNIQUE("gmail_message_id")
);
--> statement-breakpoint
CREATE TABLE "email_threads" (
	"id" serial PRIMARY KEY NOT NULL,
	"gmail_thread_id" text NOT NULL,
	"primary_contact_id" integer,
	"primary_account_id" integer,
	"primary_lead_id" integer,
	"primary_opportunity_id" integer,
	"primary_partner_id" integer,
	"association_status" text DEFAULT 'unassociated',
	"workflow_state" text,
	"snoozed_until" timestamp,
	"follow_up_at" timestamp,
	"assigned_user_id" integer,
	"reply_status" text DEFAULT 'none',
	"awaiting_reply_since" timestamp with time zone,
	"last_inbound_at" timestamp with time zone,
	"last_outbound_at" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "email_threads_gmail_thread_id_unique" UNIQUE("gmail_thread_id")
);
--> statement-breakpoint
CREATE TABLE "email_tracking_pixels" (
	"id" serial PRIMARY KEY NOT NULL,
	"tracking_id" text NOT NULL,
	"gmail_message_id" text,
	"subject" text,
	"recipient_email" text,
	"sent_by_user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"is_replied" boolean DEFAULT false NOT NULL,
	CONSTRAINT "email_tracking_pixels_tracking_id_unique" UNIQUE("tracking_id")
);
--> statement-breakpoint
CREATE TABLE "execution_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"reminder_hour" integer DEFAULT 9 NOT NULL,
	"overdue_escalation_days" integer DEFAULT 3 NOT NULL,
	"max_reminders_per_day" integer DEFAULT 3 NOT NULL,
	"manager_digest_enabled" boolean DEFAULT true NOT NULL,
	"suggestions_in_digest" boolean DEFAULT true NOT NULL,
	"bulk_confirm_enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "executive_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"severity" text DEFAULT 'medium' NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"linked_object_type" text,
	"linked_object_id" integer,
	"status" text DEFAULT 'open' NOT NULL,
	"score" integer DEFAULT 0,
	"brief_date" text,
	"suggested_move" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "executive_briefs" (
	"id" serial PRIMARY KEY NOT NULL,
	"brief_date" text NOT NULL,
	"headline" text NOT NULL,
	"summary" text NOT NULL,
	"payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "executive_briefs_brief_date_unique" UNIQUE("brief_date")
);
--> statement-breakpoint
CREATE TABLE "infrastructure_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"existing_pedestal_brands" text,
	"pedestal_age_avg_years" real,
	"pedestal_age_oldest_years" real,
	"power_per_slip" text,
	"pct_slips_30a" real,
	"pct_slips_50a" real,
	"voltage_types" text,
	"metering_today" text,
	"billing_method" text,
	"leakage_detection" text,
	"breaker_trip_pain" text,
	"known_failure_modes" text,
	"recent_incidents" text,
	"compliance_jurisdiction" text,
	"compliance_pressure" text,
	"compliance_deadline" text,
	"inspection_notes" text,
	"marina_management_software" text,
	"accounting_system" text,
	"payment_provider" text,
	"wifi_maturity" text,
	"it_contact_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "install_milestones" (
	"id" serial PRIMARY KEY NOT NULL,
	"workflow_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"owner_user_id" integer,
	"due_date" timestamp,
	"completed_at" timestamp,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "install_workflows" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'pending_kickoff' NOT NULL,
	"quote_id" integer,
	"opportunity_id" integer,
	"account_id" integer,
	"owner_user_id" integer,
	"kickoff_date" timestamp,
	"target_completion_date" timestamp,
	"actual_completion_date" timestamp,
	"notes" text,
	"blockers" text,
	"total_amount" real,
	"quote_number" text,
	"customer_name" text,
	"site_address" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"part_id" integer NOT NULL,
	"location" text DEFAULT 'warehouse' NOT NULL,
	"quantity_on_hand" real DEFAULT 0 NOT NULL,
	"quantity_allocated" real DEFAULT 0 NOT NULL,
	"quantity_reserved_cert" real DEFAULT 0 NOT NULL,
	"install_workflow_id" integer,
	"notes" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer NOT NULL,
	"contact_id" integer NOT NULL,
	"role" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" serial PRIMARY KEY NOT NULL,
	"company" text NOT NULL,
	"contact_name" text NOT NULL,
	"contact_email" text,
	"contact_phone" text,
	"source" text,
	"status" text DEFAULT 'new' NOT NULL,
	"owner_user_id" integer,
	"notes" text,
	"tags" text,
	"next_step" text,
	"due_date" timestamp,
	"marina_id" integer,
	"country" text,
	"state" text,
	"city" text,
	"slips" text,
	"segment" text,
	"street_address" text,
	"zip_code" text,
	"deal_amount" real,
	"deal_currency" text DEFAULT 'USD',
	"deal_probability" integer,
	"deal_value_hardware" real,
	"deal_value_software" real,
	"deal_value_services" real,
	"primary_value_driver" text,
	"estimated_pedestal_count" integer,
	"estimated_slips_impacted" integer,
	"est_close_date" timestamp,
	"competitors" text,
	"roi_story" text,
	"closed_lost_reason" text,
	"closed_won_notes" text,
	"lead_lat" real,
	"lead_lng" real,
	"converted_account_id" integer,
	"converted_contact_id" integer,
	"converted_opportunity_id" integer,
	"converted_at" timestamp,
	"source_detail" text,
	"acquisition_channel" text,
	"referrer_name" text,
	"referrer_contact_id" integer,
	"campaign_tag" text,
	"original_source" text,
	"source_captured_at" timestamp,
	"region" text,
	"territory_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_folder_domains" (
	"id" serial PRIMARY KEY NOT NULL,
	"folder_id" integer NOT NULL,
	"domain" text NOT NULL,
	"match_type" text DEFAULT 'ends_with' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_folders" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer DEFAULT 1 NOT NULL,
	"owner_user_id" integer NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT 'teal' NOT NULL,
	"source_account_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marinas" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"state" text NOT NULL,
	"city" text NOT NULL,
	"slips" text,
	"segment" text,
	"latitude" double precision,
	"longitude" double precision,
	"phone" text,
	"street_address" text,
	"zip_code" text
);
--> statement-breakpoint
CREATE TABLE "meeting_note_action_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"meeting_note_id" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"owner_name" text,
	"owner_user_id" integer,
	"due_date" timestamp,
	"source_quote" text,
	"confidence_score" numeric(4, 3),
	"status" text DEFAULT 'suggested' NOT NULL,
	"created_task_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_note_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"meeting_note_id" integer NOT NULL,
	"object_type" text NOT NULL,
	"object_id" integer NOT NULL,
	"relationship_type" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_note_participants" (
	"id" serial PRIMARY KEY NOT NULL,
	"meeting_note_id" integer NOT NULL,
	"name" text,
	"email" text,
	"user_id" integer,
	"contact_id" integer,
	"is_internal" boolean DEFAULT false NOT NULL,
	"speaker_label" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_note_transcript_chunks" (
	"id" serial PRIMARY KEY NOT NULL,
	"meeting_note_id" integer NOT NULL,
	"sequence_no" integer NOT NULL,
	"speaker_label" text,
	"start_ms" integer,
	"end_ms" integer,
	"text" text NOT NULL,
	"is_final" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"uuid" text NOT NULL,
	"title" text,
	"status" text DEFAULT 'scheduled_prompted' NOT NULL,
	"source" text NOT NULL,
	"created_by" integer NOT NULL,
	"calendar_event_id" integer,
	"email_thread_id" text,
	"email_message_id" integer,
	"linked_object_type" text,
	"linked_object_id" integer,
	"started_at" timestamp,
	"ended_at" timestamp,
	"duration_seconds" integer,
	"platform" text,
	"audio_storage_key" text,
	"raw_transcript_text" text,
	"clean_transcript_text" text,
	"summary_text" text,
	"notes_text" text,
	"decisions_text" text,
	"action_items_text" text,
	"followup_draft_text" text,
	"processing_error" text,
	"consent_noted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_notes_uuid_unique" UNIQUE("uuid")
);
--> statement-breakpoint
CREATE TABLE "merge_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"primary_id" integer NOT NULL,
	"secondary_id" integer NOT NULL,
	"merged_by_user_id" integer NOT NULL,
	"merged_at" timestamp DEFAULT now() NOT NULL,
	"field_resolutions" jsonb,
	"linked_object_counts" jsonb,
	"warnings" jsonb,
	"primary_snapshot_json" jsonb,
	"secondary_snapshot_json" jsonb,
	"archived_secondary" boolean DEFAULT true
);
--> statement-breakpoint
CREATE TABLE "metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"value" text NOT NULL,
	"change" text NOT NULL,
	"description" text NOT NULL,
	"icon" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "migration_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"migration_name" text NOT NULL,
	"batch_id" text NOT NULL,
	"source_table" text NOT NULL,
	"source_id" integer NOT NULL,
	"target_table" text NOT NULL,
	"target_id" integer,
	"migration_status" text DEFAULT 'pending' NOT NULL,
	"migrated_at" timestamp,
	"verified_at" timestamp,
	"children_migrated_at" timestamp,
	"error_message" text,
	"ran_by_user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "migration_map" (
	"id" serial PRIMARY KEY NOT NULL,
	"legacy_table" text NOT NULL,
	"legacy_record_id" integer NOT NULL,
	"new_table" text NOT NULL,
	"new_record_id" integer NOT NULL,
	"migrated_at" timestamp DEFAULT now() NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"linked_object_type" text NOT NULL,
	"linked_object_id" integer NOT NULL,
	"author_id" integer,
	"author_name" text DEFAULT 'System' NOT NULL,
	"content" text NOT NULL,
	"is_pinned" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"severity" text DEFAULT 'medium' NOT NULL,
	"linked_object_type" text,
	"linked_object_id" integer,
	"action_url" text DEFAULT '/' NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"dedupe_key" text,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"contact_id" integer,
	"title" text NOT NULL,
	"stage" text DEFAULT 'inbound_new' NOT NULL,
	"owner_user_id" integer,
	"est_close_date" timestamp,
	"amount" real DEFAULT 0,
	"currency" text DEFAULT 'USD' NOT NULL,
	"forecast_category" text DEFAULT 'pipeline' NOT NULL,
	"value_hardware" real DEFAULT 0,
	"value_software" real DEFAULT 0,
	"value_services" real DEFAULT 0,
	"value_total" real DEFAULT 0,
	"next_step" text,
	"next_step_due_date" timestamp,
	"last_activity_date" timestamp,
	"pain_clarity" integer DEFAULT 0,
	"economic_buyer_identified" text DEFAULT 'unknown',
	"decision_criteria_known" text DEFAULT 'unknown',
	"decision_process_known" text DEFAULT 'unknown',
	"competition" text DEFAULT 'unknown',
	"champion_identified" text DEFAULT 'unknown',
	"timeline" text DEFAULT 'unknown',
	"estimated_pedestal_count" integer,
	"estimated_slips_impacted" integer,
	"primary_value_driver" text,
	"risk_flags" text,
	"roi_story" text,
	"is_stalled" boolean DEFAULT false,
	"stalled_at" timestamp,
	"closed_lost_reason" text,
	"closed_lost_competitor" text,
	"closed_lost_notes" text,
	"closed_won_notes" text,
	"competitors" text,
	"notes" text,
	"lead_source" text,
	"acquisition_channel" text,
	"original_source" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunity_contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"opportunity_id" integer NOT NULL,
	"contact_id" integer NOT NULL,
	"role" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partnerships" (
	"id" serial PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"name" text NOT NULL,
	"region" text,
	"country" text,
	"website" text,
	"strategic_importance" text,
	"influence_score" integer,
	"notes" text,
	"key_contacts" text,
	"organization_type" text,
	"membership_status" text,
	"marinas_represented" integer,
	"events_hosted" text,
	"speaking_opportunities" text,
	"technology_category" text,
	"integration_status" text,
	"api_available" boolean,
	"integration_type" text,
	"technical_contact" text,
	"joint_roadmap_notes" text,
	"priority_level" text,
	"integration_doc_link" text,
	"channel_type" text,
	"territory" text,
	"sales_reach" integer,
	"certification_status" text,
	"training_completed_date" timestamp,
	"deal_registration_enabled" boolean,
	"active_opportunities" integer,
	"revenue_generated" real,
	"industry" text,
	"license_type" text,
	"royalty_structure" text,
	"contract_status" text,
	"product_integration_description" text,
	"expected_revenue_potential" text,
	"agency_body" text,
	"grant_type" text,
	"funding_amount" real,
	"application_status" text,
	"reporting_requirements" text,
	"start_date" timestamp,
	"end_date" timestamp,
	"deliverables" text,
	"institution_type" text,
	"research_focus" text,
	"program_name" text,
	"project_description" text,
	"participation_status" text,
	"ip_considerations" text,
	"key_researchers" text,
	"slip_count" integer,
	"pilot_status" text,
	"deployment_size" integer,
	"product_version_installed" text,
	"case_study_status" text,
	"testimonial_status" text,
	"operational_feedback" text,
	"industry_types" text[],
	"migrated_account_id" integer,
	"migration_status" text DEFAULT 'legacy',
	"migration_batch_id" text,
	"migrated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parts" (
	"id" serial PRIMARY KEY NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text,
	"unit" text DEFAULT 'each' NOT NULL,
	"unit_cost" real,
	"supplier_id" integer,
	"lead_time_days" integer,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_list_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"price_list_id" integer NOT NULL,
	"sku" text DEFAULT '' NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '',
	"category" text DEFAULT 'hardware' NOT NULL,
	"list_price" double precision DEFAULT 0,
	"unit_type" text DEFAULT 'per unit' NOT NULL,
	"is_recurring" boolean DEFAULT false,
	"sort_order" integer DEFAULT 0,
	"industry_code" text DEFAULT 'GEN',
	"industry_name" text DEFAULT 'General',
	"commercial_type" text DEFAULT 'hardware',
	"product_family" text,
	"power_level" text,
	"pricing_model" text DEFAULT 'one_time',
	"billing_interval" text,
	"is_active" boolean DEFAULT true,
	"is_primary_quote_item" boolean DEFAULT false,
	"item_currency" text,
	"notes_internal" text,
	"quote_description" text,
	"usage_unit" text,
	"royalty_type" text,
	"royalty_rate" double precision,
	"minimum_commitment" text,
	"licensing_terms" text,
	"service_scope" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_lists" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"description" text,
	"is_default" boolean DEFAULT false,
	"region" text,
	"customer_segment" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_number" text NOT NULL,
	"part_id" integer,
	"part_name" text,
	"quantity" real DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"install_workflow_id" integer,
	"account_id" integer,
	"owner_user_id" integer,
	"planned_start_date" timestamp,
	"actual_start_date" timestamp,
	"target_completion_date" timestamp,
	"actual_completion_date" timestamp,
	"notes" text,
	"blockers" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_certifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"certification_program" text,
	"certification_scope" text,
	"product_name" text,
	"product_version" text,
	"product_revision" text,
	"sku_or_internal_code" text,
	"certification_priority" text DEFAULT 'medium',
	"testing_lab_name" text,
	"lab_contact_name" text,
	"lab_contact_email" text,
	"lab_contact_phone" text,
	"certification_standard_codes" text,
	"target_market" text,
	"application_submission_date" timestamp,
	"planned_test_start_date" timestamp,
	"actual_test_start_date" timestamp,
	"target_completion_date" timestamp,
	"actual_completion_date" timestamp,
	"certification_status" text DEFAULT 'Planning',
	"overall_risk" text DEFAULT 'Low',
	"launch_blocker" boolean DEFAULT false,
	"blocker_summary" text,
	"last_status_update" timestamp,
	"next_action" text,
	"next_action_due_date" timestamp,
	"sample_units_required" integer,
	"sample_units_built" integer,
	"sample_units_shipped" integer,
	"sample_units_received_by_lab" integer,
	"sample_serial_numbers" text,
	"sample_notes" text,
	"failure_found" boolean DEFAULT false,
	"failure_summary" text,
	"corrective_action_required" boolean DEFAULT false,
	"corrective_action_summary" text,
	"retest_required" boolean DEFAULT false,
	"retest_date" timestamp,
	"pass_date" timestamp,
	"certificate_issue_date" timestamp,
	"certificate_expiry_date" timestamp,
	"internal_owner_user_id" integer,
	"engineering_owner" text,
	"operations_owner" text,
	"linked_supplier" text,
	"linked_production_batch" text,
	"estimated_certification_cost" real,
	"actual_certification_cost" real,
	"budget_status" text DEFAULT 'On Budget',
	"certification_doc_link" text,
	"test_report_link" text,
	"shared_drive_folder_link" text,
	"certificate_file" text,
	"compliance_notes" text,
	"tracker_sheet_url" text,
	"tracker_sheet_config" text,
	"tracker_sheet_last_synced" timestamp,
	"tracker_alert_state" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_certifications_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
CREATE TABLE "project_milestones" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'pending',
	"sort_order" integer DEFAULT 0,
	"due_date" timestamp,
	"completed_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'pilot' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"phase" text,
	"description" text,
	"account_id" integer,
	"linked_opportunity_id" integer,
	"owner_user_id" integer,
	"budget" real,
	"currency" text DEFAULT 'USD',
	"start_date" timestamp,
	"end_date" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_order_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"purchase_order_id" integer NOT NULL,
	"part_id" integer,
	"description" text,
	"quantity" real DEFAULT 1 NOT NULL,
	"quantity_received" real DEFAULT 0 NOT NULL,
	"unit_cost" real,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"po_number" text NOT NULL,
	"supplier_id" integer,
	"status" text DEFAULT 'draft' NOT NULL,
	"account_id" integer,
	"opportunity_id" integer,
	"install_workflow_id" integer,
	"owner_user_id" integer,
	"expected_delivery_date" timestamp,
	"actual_delivery_date" timestamp,
	"issued_at" timestamp,
	"total_amount" real,
	"currency" text DEFAULT 'USD' NOT NULL,
	"notes" text,
	"blockers" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_line_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"quote_id" integer NOT NULL,
	"category" text DEFAULT 'hardware' NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"qty" real DEFAULT 1 NOT NULL,
	"unit_price" real DEFAULT 0 NOT NULL,
	"list_price" real DEFAULT 0,
	"discount_percent" real DEFAULT 0,
	"unit_type" text,
	"line_total" real DEFAULT 0 NOT NULL,
	"is_recurring" boolean DEFAULT false,
	"sort_order" integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE "quote_status_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"quote_id" integer NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"user_id" integer,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" serial PRIMARY KEY NOT NULL,
	"quote_number" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"quote_type" text DEFAULT 'marina_solution' NOT NULL,
	"account_id" integer,
	"opportunity_id" integer,
	"contact_id" integer,
	"currency" text DEFAULT 'USD' NOT NULL,
	"country" text DEFAULT 'US',
	"created_by" integer,
	"valid_until" timestamp,
	"subtotal" real DEFAULT 0,
	"tax" real DEFAULT 0,
	"total" real DEFAULT 0,
	"assumptions" text,
	"exclusions" text,
	"notes" text,
	"sent_at" timestamp,
	"accepted_at" timestamp,
	"declined_at" timestamp,
	"archived_at" timestamp,
	"owner_user_id" integer,
	"customer_name" text,
	"customer_email" text,
	"customer_phone" text,
	"marina_address" text,
	"site_address" text,
	"billing_period_start" text,
	"billing_period_end" text,
	"entitlement_number" text,
	"licensed_to" text,
	"payment_term_deposit" integer DEFAULT 10,
	"payment_term_production" integer DEFAULT 40,
	"payment_term_install" integer DEFAULT 50,
	"tax_rate" real DEFAULT 0,
	"tax_amount" real DEFAULT 0,
	"hardware_subtotal" real DEFAULT 0,
	"software_subtotal" real DEFAULT 0,
	"deposit_due" real DEFAULT 0,
	"slips_count" integer,
	"xlsx_asset_id" integer,
	"html_asset_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "quotes_quote_number_unique" UNIQUE("quote_number")
);
--> statement-breakpoint
CREATE TABLE "record_tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"tag_id" integer NOT NULL,
	"record_type" text NOT NULL,
	"record_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_presets" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"report_type" text DEFAULT 'executive_weekly' NOT NULL,
	"date_range_preset" text DEFAULT 'this_month' NOT NULL,
	"custom_date_from" timestamp,
	"custom_date_to" timestamp,
	"owner_user_id" integer,
	"region_filter" text,
	"included_sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "revenue_forecast_actuals" (
	"id" serial PRIMARY KEY NOT NULL,
	"month_key" text NOT NULL,
	"forecast_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"actual_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"forecasted_from_scenario_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "revenue_forecast_actuals_month_key_unique" UNIQUE("month_key")
);
--> statement-breakpoint
CREATE TABLE "revenue_gap_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"month_key" text NOT NULL,
	"snapshot_date" timestamp DEFAULT now() NOT NULL,
	"committed_revenue" numeric(12, 2) DEFAULT '0' NOT NULL,
	"actual_revenue_to_date" numeric(12, 2) DEFAULT '0' NOT NULL,
	"forecast_revenue_to_date" numeric(12, 2) DEFAULT '0' NOT NULL,
	"projected_month_end_revenue" numeric(12, 2) DEFAULT '0' NOT NULL,
	"gap_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"gap_percent" numeric(8, 2) DEFAULT '0' NOT NULL,
	"source_scenario_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "revenue_plan_commits" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"scenario_id" integer,
	"month_key" text NOT NULL,
	"committed_revenue" numeric(12, 2) DEFAULT '0' NOT NULL,
	"baseline_revenue" numeric(12, 2) DEFAULT '0' NOT NULL,
	"stretch_revenue" numeric(12, 2),
	"notes" text,
	"status" text DEFAULT 'active' NOT NULL,
	"committed_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "revenue_scenarios" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_by" integer NOT NULL,
	"parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"projection" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"baseline_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"board_pack_include" boolean DEFAULT false NOT NULL,
	"source_type" text DEFAULT 'manual' NOT NULL,
	"snapshot_date" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "revenue_simulator_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"scenario_id" integer NOT NULL,
	"title" text NOT NULL,
	"owner_user_id" integer,
	"linked_object_type" text,
	"linked_object_id" integer,
	"due_date" timestamp,
	"status" text DEFAULT 'open' NOT NULL,
	"notes" text,
	"created_by" integer,
	"priority" text DEFAULT 'medium' NOT NULL,
	"action_type" text DEFAULT 'manual',
	"plan_commit_id" integer,
	"metric_target" numeric(12, 2),
	"metric_unit" text,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rollout_phases" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"phase_name" text NOT NULL,
	"dock_finger_zone" text,
	"planned_units" integer DEFAULT 0 NOT NULL,
	"installed_units" integer DEFAULT 0 NOT NULL,
	"target_install_date" date,
	"actual_install_date" date,
	"status" text DEFAULT 'planned' NOT NULL,
	"blockers" text,
	"linked_deployment_id" integer,
	"linked_quote_id" integer,
	"linked_po_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saas_billing_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"line_type" text DEFAULT 'full_smart_slip' NOT NULL,
	"label" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"monthly_rate" numeric(10, 4) DEFAULT '0' NOT NULL,
	"annual_rate" numeric(10, 4),
	"billing_start_date" date,
	"billing_end_date" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"linked_phase_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"amount" text NOT NULL,
	"avatar_url" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_views" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"page_key" text NOT NULL,
	"filters_json" text,
	"columns_json" text,
	"sort_by" text,
	"sort_order" text DEFAULT 'asc',
	"user_id" integer,
	"is_shared" boolean DEFAULT false,
	"is_default" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_emails" (
	"id" serial PRIMARY KEY NOT NULL,
	"to" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"thread_id" text,
	"scheduled_at" timestamp NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"sent_at" timestamp,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "score_acknowledgments" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"model_name" text NOT NULL,
	"record_type" text NOT NULL,
	"record_id" integer NOT NULL,
	"acknowledged_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "services_estimates" (
	"id" serial PRIMARY KEY NOT NULL,
	"quote_id" integer NOT NULL,
	"role" text NOT NULL,
	"hours_estimate" real DEFAULT 0 NOT NULL,
	"hourly_rate" real DEFAULT 0 NOT NULL,
	"subtotal" real DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"contact_name" text,
	"contact_email" text,
	"phone" text,
	"country" text,
	"region" text,
	"lead_time_days" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT 'blue' NOT NULL,
	"category" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tags_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "task_activity" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"user_id" integer,
	"action" text NOT NULL,
	"from_value" text,
	"to_value" text,
	"meta" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_board_views" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" text NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_checklist_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"checklist_id" integer NOT NULL,
	"content" text NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp,
	"completed_by_user_id" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_checklists" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"title" text DEFAULT 'Checklist' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_dependencies" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"depends_on_task_id" integer NOT NULL,
	"created_by_user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_digests" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"digest_type" text NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"payload" jsonb NOT NULL,
	"delivered_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_label_assignments" (
	"task_id" integer NOT NULL,
	"label_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_labels" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT 'slate' NOT NULL,
	"created_by_user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_reminder_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"reminder_type" text NOT NULL,
	"channel" text DEFAULT 'in_app' NOT NULL,
	"notification_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_rule_configs" (
	"rule_id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"threshold_value" integer DEFAULT 7 NOT NULL,
	"threshold_unit" text DEFAULT 'days' NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"assignee_strategy" text DEFAULT 'record_owner' NOT NULL,
	"default_assignee_user_id" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "task_suggestions" (
	"id" serial PRIMARY KEY NOT NULL,
	"object_type" text NOT NULL,
	"object_id" integer NOT NULL,
	"signal_type" text NOT NULL,
	"severity" text DEFAULT 'medium' NOT NULL,
	"title" text NOT NULL,
	"reason" text NOT NULL,
	"suggested_action_type" text NOT NULL,
	"suggested_action_label" text NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"suggested_due_date" timestamp,
	"status" text DEFAULT 'pending' NOT NULL,
	"snoozed_until" timestamp,
	"created_task_id" integer,
	"dismissed_at" timestamp,
	"accepted_at" timestamp,
	"source_signals" text,
	"suggested_assignee_id" integer,
	"confidence" integer DEFAULT 50,
	"source_label" text,
	"dismissed_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_watchers" (
	"task_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"linked_object_type" text,
	"linked_object_id" integer,
	"account_id" integer,
	"owner_user_id" integer,
	"created_by_user_id" integer,
	"title" text NOT NULL,
	"description" text,
	"due_date" timestamp,
	"start_date" timestamp,
	"status" text DEFAULT 'pending' NOT NULL,
	"board_column" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"ai_suggested" boolean DEFAULT false,
	"reminder_at" timestamp,
	"source" text DEFAULT 'manual',
	"source_label" text,
	"source_meta" jsonb,
	"snoozed_until" timestamp,
	"dismissed_at" timestamp,
	"dismissed_by" integer,
	"completed_at" timestamp,
	"completed_by_user_id" integer,
	"completion_notes" text,
	"last_updated_by_user_id" integer,
	"archived" boolean DEFAULT false NOT NULL,
	"last_reminded_at" timestamp,
	"reminder_count" integer DEFAULT 0,
	"escalation_level" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "territories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"owner_user_id" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"color" text,
	"regions" text,
	"countries" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_number" text,
	"account_id" integer,
	"contact_id" integer,
	"category" text DEFAULT 'general' NOT NULL,
	"severity" text DEFAULT 'medium' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"source" text DEFAULT 'email',
	"escalation_status" text,
	"sla_due_at" timestamp,
	"requester_name" text NOT NULL,
	"requester_email" text,
	"requester_phone" text,
	"assigned_to_user_id" integer,
	"subject" text NOT NULL,
	"description" text,
	"internal_notes" text,
	"resolution_summary" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password" text NOT NULL,
	"role" text DEFAULT 'read-only' NOT NULL,
	"global_role" text DEFAULT 'sales' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"user_type" text DEFAULT 'internal' NOT NULL,
	"department" text,
	"job_title" text,
	"invited_by" integer,
	"suspended_at" timestamp,
	"suspended_reason" text,
	"must_change_password" boolean DEFAULT true NOT NULL,
	"avatar_url" text,
	"password_reset_token" text,
	"password_reset_expires" timestamp,
	"permissions" jsonb DEFAULT '{"crm":"edit","partnerships":"edit","projects":"edit","communications":"edit","team_workload":"edit","knowledge":"edit","support":"edit","quoting":"edit","calendar":"edit","mail_team":{},"calendar_team":[]}'::jsonb,
	"preferred_layout" text DEFAULT 'expanded' NOT NULL,
	"widget_visibility" jsonb DEFAULT '{}'::jsonb,
	"dashboard_layouts" jsonb DEFAULT '{}'::jsonb,
	"default_command_center" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_login" timestamp,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "webauthn_credentials" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" text NOT NULL,
	"counter" integer DEFAULT 0 NOT NULL,
	"device_name" text,
	"transports" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "webauthn_credentials_credential_id_unique" UNIQUE("credential_id")
);
--> statement-breakpoint
CREATE TABLE "winter_kb_articles" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"issue_type" text NOT NULL,
	"description" text,
	"approved_response" text,
	"internal_notes" text,
	"status" text DEFAULT 'active' NOT NULL,
	"applies_to_versions" text[],
	"related_case_count" integer DEFAULT 0,
	"last_reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "winter_products" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sku" text,
	"version" text,
	"launch_year" integer,
	"certifications" text[],
	"units_sold" integer DEFAULT 0,
	"channels" text[],
	"status" text DEFAULT 'legacy' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "winter_support_cases" (
	"id" serial PRIMARY KEY NOT NULL,
	"case_number" text NOT NULL,
	"customer_name" text,
	"customer_email" text,
	"email_thread_id" text,
	"gmail_thread_id" text,
	"issue_type" text DEFAULT 'general' NOT NULL,
	"severity" text DEFAULT 'medium' NOT NULL,
	"product_id" integer,
	"product_version" text,
	"country" text,
	"status" text DEFAULT 'open' NOT NULL,
	"owner_id" integer,
	"resolution" text,
	"auto_detected" boolean DEFAULT false,
	"sentiment_score" integer,
	"kb_article_id" integer,
	"subject" text,
	"body_excerpt" text,
	"tags" text[],
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "winter_support_cases_case_number_unique" UNIQUE("case_number")
);
--> statement-breakpoint
CREATE TABLE "zoom_connections" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"zoom_user_id" text,
	"zoom_email" text,
	"zoom_account_type" text,
	"zoom_pmi" text,
	"zoom_pmi_url" text,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"token_expires_at" timestamp NOT NULL,
	"scope" text,
	"connected_at" timestamp DEFAULT now() NOT NULL,
	"disconnected_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"user_id" integer,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_folder_id_asset_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."asset_folders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_accounts" ADD CONSTRAINT "email_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_attachments" ADD CONSTRAINT "email_attachments_message_id_email_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."email_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_filters" ADD CONSTRAINT "email_filters_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_folder_assignments" ADD CONSTRAINT "email_folder_assignments_email_id_email_messages_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."email_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_folder_assignments" ADD CONSTRAINT "email_folder_assignments_folder_id_mail_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."mail_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_folder_domains" ADD CONSTRAINT "mail_folder_domains_folder_id_mail_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."mail_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_folders" ADD CONSTRAINT "mail_folders_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;