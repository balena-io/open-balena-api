CREATE TABLE IF NOT EXISTS "device type alias" (
	"created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"device type" INTEGER NOT NULL
,	"is referenced by-alias" VARCHAR(255) NOT NULL UNIQUE
,	"id" SERIAL NOT NULL PRIMARY KEY
,	FOREIGN KEY ("device type") REFERENCES "device type" ("id")
,	UNIQUE("device type", "is referenced by-alias")
);

DO
$$
BEGIN
IF NOT EXISTS(
	SELECT 1
	FROM "information_schema"."triggers"
	WHERE "event_object_table" = 'device type alias'
	AND "trigger_name" = 'device type alias_trigger_update_modified_at'
) THEN
	CREATE TRIGGER "device type alias_trigger_update_modified_at"
	BEFORE UPDATE ON "device type alias"
	FOR EACH ROW
	EXECUTE PROCEDURE "trigger_update_modified_at"();
END IF;
END;
$$;
