CREATE TABLE IF NOT EXISTS "scheduled job run" (
	"created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	"name" VARCHAR(255) NOT NULL
,	"start timestamp" TIMESTAMP NOT NULL
,	"end timestamp" TIMESTAMP NULL
,	"status" VARCHAR(255) NOT NULL CHECK ("status" IN ('running', 'success', 'error'))
,	-- It is necessary that each scheduled job run that has a status that is equal to "success", has an end timestamp.
CONSTRAINT "scheduled job run$wRT+EFBynm3yyXccCcMT2Jy+lMxnqwEmH8VyLPRJ02Q=" CHECK (NOT (
	"status" = 'success'
	AND "status" IS NOT NULL
	AND "end timestamp" IS NULL
))
);

CREATE INDEX IF NOT EXISTS "scheduled_job_run_start_timestamp_idx"
ON "scheduled job run" (DATE_TRUNC('milliseconds', "start timestamp"));

DO
$$
BEGIN
	IF NOT EXISTS(
		SELECT 1
		FROM "information_schema"."triggers"
		WHERE "event_object_table" = 'scheduled job run'
		AND "trigger_name" = 'scheduled job run_trigger_update_modified_at'
	) THEN
		CREATE TRIGGER "scheduled job run_trigger_update_modified_at"
		BEFORE UPDATE ON "scheduled job run"
		FOR EACH ROW
		EXECUTE PROCEDURE "trigger_update_modified_at"();
	END IF;
END;
$$;
