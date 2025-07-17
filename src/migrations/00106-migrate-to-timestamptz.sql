-- Migrate "actor" table

ALTER TABLE "actor"
ALTER COLUMN "created at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "modified at" SET DATA TYPE TIMESTAMPTZ;

-- Migrate "api key" table

ALTER TABLE "api key"
ALTER COLUMN "created at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "modified at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "expiry date" SET DATA TYPE TIMESTAMPTZ;

-- Migrate "api key-has-permission" table

ALTER TABLE "api key-has-permission"
ALTER COLUMN "created at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "modified at" SET DATA TYPE TIMESTAMPTZ;

-- Migrate "api key-has-role" table

ALTER TABLE "api key-has-role"
ALTER COLUMN "created at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "modified at" SET DATA TYPE TIMESTAMPTZ;

-- Migrate "application" table

ALTER TABLE "application"
ALTER COLUMN "created at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "modified at" SET DATA TYPE TIMESTAMPTZ;

-- Migrate "application config variable" table

ALTER TABLE "application config variable"
ALTER COLUMN "created at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "modified at" SET DATA TYPE TIMESTAMPTZ;

-- Migrate "application environment variable" table

ALTER TABLE "application environment variable"
ALTER COLUMN "created at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "modified at" SET DATA TYPE TIMESTAMPTZ;

-- Migrate "application tag" table

ALTER TABLE "application tag"
ALTER COLUMN "created at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "modified at" SET DATA TYPE TIMESTAMPTZ;

-- Migrate "application type" table

ALTER TABLE "application type"
ALTER COLUMN "created at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "modified at" SET DATA TYPE TIMESTAMPTZ;

-- Migrate "config" table

ALTER TABLE "config"
ALTER COLUMN "created at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "modified at" SET DATA TYPE TIMESTAMPTZ;

-- Migrate "cpu architecture" table

ALTER TABLE "cpu architecture"
ALTER COLUMN "created at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "modified at" SET DATA TYPE TIMESTAMPTZ;

-- Migrate "device" table

ALTER TABLE "device"
ALTER COLUMN "created at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "modified at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "changed api heartbeat state on-date" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "last connectivity event" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "last vpn event" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "is locked until-date" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "last update status event" SET DATA TYPE TIMESTAMPTZ;

-- Migrate "device config variable" table

ALTER TABLE "device config variable"
ALTER COLUMN "created at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "modified at" SET DATA TYPE TIMESTAMPTZ;

-- Migrate "device environment variable" table

ALTER TABLE "device environment variable"
ALTER COLUMN "created at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "modified at" SET DATA TYPE TIMESTAMPTZ;

-- Migrate "device family" table

ALTER TABLE "device family"
ALTER COLUMN "created at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "modified at" SET DATA TYPE TIMESTAMPTZ;

-- Migrate "device manufacturer" table

ALTER TABLE "device manufacturer"
ALTER COLUMN "created at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "modified at" SET DATA TYPE TIMESTAMPTZ;

-- Migrate "device service environment variable" table

ALTER TABLE "device service environment variable"
ALTER COLUMN "created at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "modified at" SET DATA TYPE TIMESTAMPTZ;

-- Migrate "device tag" table

ALTER TABLE "device tag"
ALTER COLUMN "created at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "modified at" SET DATA TYPE TIMESTAMPTZ;

-- Migrate "device type" table

ALTER TABLE "device type"
ALTER COLUMN "created at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "modified at" SET DATA TYPE TIMESTAMPTZ;

-- Migrate "device type alias" table

ALTER TABLE "device type alias"
ALTER COLUMN "created at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "modified at" SET DATA TYPE TIMESTAMPTZ;

-- Migrate "image" table

ALTER TABLE "image"
ALTER COLUMN "created at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "modified at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "start timestamp" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "end timestamp" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "push timestamp" SET DATA TYPE TIMESTAMPTZ;

-- Migrate "image environment variable" table

ALTER TABLE "image environment variable"
ALTER COLUMN "created at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "modified at" SET DATA TYPE TIMESTAMPTZ;

-- Migrate "image install" table

ALTER TABLE "image install"
ALTER COLUMN "created at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "modified at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "install date" SET DATA TYPE TIMESTAMPTZ;

-- Migrate "image label" table

ALTER TABLE "image label"
ALTER COLUMN "created at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "modified at" SET DATA TYPE TIMESTAMPTZ;

-- Migrate "image-is part of-release" table

ALTER TABLE "image-is part of-release"
ALTER COLUMN "created at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "modified at" SET DATA TYPE TIMESTAMPTZ;

-- Migrate "migration" table

ALTER TABLE "migration"
ALTER COLUMN "created at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "modified at" SET DATA TYPE TIMESTAMPTZ;

-- Migrate "migration lock" table

ALTER TABLE "migration lock"
ALTER COLUMN "created at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "modified at" SET DATA TYPE TIMESTAMPTZ;

-- Migrate "migration status" table

ALTER TABLE "migration status"
ALTER COLUMN "created at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "modified at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "start time" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "last run time" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "converged time" SET DATA TYPE TIMESTAMPTZ;

-- Migrate "model" table

ALTER TABLE "model"
ALTER COLUMN "created at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "modified at" SET DATA TYPE TIMESTAMPTZ;

-- Migrate "multipart upload" table

ALTER TABLE "multipart upload"
ALTER COLUMN "created at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "modified at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "expiry date" SET DATA TYPE TIMESTAMPTZ;

-- Migrate "organization" table

ALTER TABLE "organization"
ALTER COLUMN "created at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "modified at" SET DATA TYPE TIMESTAMPTZ;

-- Migrate "organization membership" table

ALTER TABLE "organization membership"
ALTER COLUMN "created at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "modified at" SET DATA TYPE TIMESTAMPTZ;

-- Migrate "permission" table

ALTER TABLE "permission"
ALTER COLUMN "created at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "modified at" SET DATA TYPE TIMESTAMPTZ;

-- Migrate "release" table

ALTER TABLE "release"
ALTER COLUMN "created at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "modified at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "start timestamp" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "end timestamp" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "update timestamp" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "is finalized at-date" SET DATA TYPE TIMESTAMPTZ;

-- Migrate "release asset" table

ALTER TABLE "release asset"
ALTER COLUMN "created at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "modified at" SET DATA TYPE TIMESTAMPTZ;

-- Migrate "release tag" table

ALTER TABLE "release tag"
ALTER COLUMN "created at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "modified at" SET DATA TYPE TIMESTAMPTZ;

-- Migrate "role" table

ALTER TABLE "role"
ALTER COLUMN "created at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "modified at" SET DATA TYPE TIMESTAMPTZ;

-- Migrate "role-has-permission" table

ALTER TABLE "role-has-permission"
ALTER COLUMN "created at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "modified at" SET DATA TYPE TIMESTAMPTZ;

-- Migrate "scheduled job run" table

DROP INDEX IF EXISTS "scheduled_job_run_start_timestamp_idx";

ALTER TABLE "scheduled job run"
ALTER COLUMN "created at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "modified at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "start timestamp" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "end timestamp" SET DATA TYPE TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS "scheduled_job_run_start_timestamp_idx"
ON "scheduled job run" USING btree (DATE_TRUNC('milliseconds', "start timestamp", 'UTC'));

-- Migrate "service" table

ALTER TABLE "service"
ALTER COLUMN "created at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "modified at" SET DATA TYPE TIMESTAMPTZ;

-- Migrate "service environment variable" table

ALTER TABLE "service environment variable"
ALTER COLUMN "created at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "modified at" SET DATA TYPE TIMESTAMPTZ;

-- Migrate "service install" table

ALTER TABLE "service install"
ALTER COLUMN "created at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "modified at" SET DATA TYPE TIMESTAMPTZ;

-- Migrate "service instance" table

ALTER TABLE "service instance"
ALTER COLUMN "created at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "modified at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "last heartbeat" SET DATA TYPE TIMESTAMPTZ;

-- Migrate "service label" table

ALTER TABLE "service label"
ALTER COLUMN "created at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "modified at" SET DATA TYPE TIMESTAMPTZ;

-- Migrate "task" table

DROP INDEX IF EXISTS "idx_task_poll";

ALTER TABLE "task"
ALTER COLUMN "created at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "modified at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "is scheduled to execute on-time" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "started on-time" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "ended on-time" SET DATA TYPE TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS "idx_task_poll" ON "task" USING btree (
	"is executed by-handler",
	"is scheduled to execute on-time" ASC,
	"id" ASC
) WHERE status = 'queued';

-- Migrate "user" table

ALTER TABLE "user"
ALTER COLUMN "created at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "modified at" SET DATA TYPE TIMESTAMPTZ;

-- Migrate "user-has-permission" table

ALTER TABLE "user-has-permission"
ALTER COLUMN "created at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "modified at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "expiry date" SET DATA TYPE TIMESTAMPTZ;

-- Migrate "user-has-public key" table

ALTER TABLE "user-has-public key"
ALTER COLUMN "created at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "modified at" SET DATA TYPE TIMESTAMPTZ;

-- Migrate "user-has-role" table

ALTER TABLE "user-has-role"
ALTER COLUMN "created at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "modified at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "expiry date" SET DATA TYPE TIMESTAMPTZ;
