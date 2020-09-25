CREATE TABLE IF NOT EXISTS "device-belongs to-application" (
	"created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"device" INTEGER NOT NULL
,	"belongs to-application" INTEGER NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	"should be running-release" INTEGER NULL
,	"is running-release" INTEGER NULL
,	FOREIGN KEY ("device") REFERENCES "device" ("id")
,	FOREIGN KEY ("belongs to-application") REFERENCES "application" ("id")
,	FOREIGN KEY ("should be running-release") REFERENCES "release" ("id")
,	FOREIGN KEY ("is running-release") REFERENCES "release" ("id")
,	UNIQUE("device", "belongs to-application")
);

DO
$$
BEGIN
IF NOT EXISTS(
	SELECT 1
	FROM "information_schema"."triggers"
	WHERE "event_object_table" = 'device-belongs to-application'
	AND "trigger_name" = 'device-belongs to-application_trigger_update_modified_at'
) THEN
	CREATE TRIGGER "device-belongs to-application_trigger_update_modified_at"
	BEFORE UPDATE ON "device-belongs to-application"
	FOR EACH ROW
	EXECUTE PROCEDURE "trigger_update_modified_at"();
END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "device_application_application_idx"
ON "device-belongs to-application" ("belongs to-application");
CREATE INDEX IF NOT EXISTS "device_application_is_running_release_idx"
ON "device-belongs to-application" ("is running-release");
CREATE INDEX IF NOT EXISTS "device_application_should_be_running_release_idx"
ON "device-belongs to-application" ("should be running-release");

INSERT INTO "device-belongs to-application" ("device", "belongs to-application", "should be running-release", "is running-release") (
	SELECT "id" AS "device", "belongs to-application", "should be running-release", "is running-release"
	FROM "device"
);

DROP INDEX IF EXISTS "device_application_idx";
DROP INDEX IF EXISTS "device_is_running_release_idx";
DROP INDEX IF EXISTS "device_should_be_running_release_idx";

ALTER TABLE "device"
DROP COLUMN IF EXISTS "belongs to-application",
DROP COLUMN IF EXISTS "should be running-release",
DROP COLUMN IF EXISTS "is running-release",
DROP CONSTRAINT IF EXISTS "device_belongs to-application_fkey";
