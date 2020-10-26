
CREATE TABLE IF NOT EXISTS "supervisor release" (
	"created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	"supervisor version" VARCHAR(255) NOT NULL
,	"is for-device type" INTEGER NOT NULL
,	"image name" VARCHAR(255) NOT NULL
,	"is public" INTEGER DEFAULT 0 NOT NULL
,	"note" TEXT NULL
,	FOREIGN KEY ("is for-device type") REFERENCES "device type" ("id")
);

DO
$$
BEGIN
IF NOT EXISTS(
	SELECT 1
	FROM "information_schema"."triggers"
	WHERE "event_object_table" = 'supervisor release'
	AND "trigger_name" = 'supervisor release_trigger_update_modified_at'
) THEN
	CREATE TRIGGER "supervisor release_trigger_update_modified_at"
	BEFORE UPDATE ON "supervisor release"
	FOR EACH ROW
	EXECUTE PROCEDURE "trigger_update_modified_at"();
END IF;
END;
$$;

ALTER TABLE "device"
ADD COLUMN "should be managed by-supervisor release" INTEGER NULL,
ADD CONSTRAINT "device_should be managed by-supervisor release_fkey"
	FOREIGN KEY ("should be managed by-supervisor release")
	REFERENCES "supervisor release" ("id");

CREATE INDEX IF NOT EXISTS "device_supervisor_release_device_type_idx"
ON "device" ("should be managed by-supervisor release", "is of-device type");
