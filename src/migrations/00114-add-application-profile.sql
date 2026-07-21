CREATE TABLE IF NOT EXISTS "application profile" (
	"created at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"application" INTEGER NOT NULL
,	"activates-profile name" VARCHAR(255) NOT NULL
,	"on-application" INTEGER NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	FOREIGN KEY ("application") REFERENCES "application" ("id")
,	FOREIGN KEY ("on-application") REFERENCES "application" ("id")
,	UNIQUE("application", "activates-profile name", "on-application")
,	-- It is necessary that each application profile has a profile name that has a Length (Type) that is greater than 1 and is less than or equal to 100.
CONSTRAINT "application profile$k/Bekz9Smd13LHmP3Y6oPtMhUi8unEjtt/fuIVmA7M4" CHECK (1 < LENGTH("activates-profile name")
AND LENGTH("activates-profile name") <= 100
AND LENGTH("activates-profile name") IS NOT NULL
AND "activates-profile name" IS NOT NULL)
);

DO
$$
BEGIN
	IF NOT EXISTS(
		SELECT 1
		FROM "information_schema"."triggers"
		WHERE "event_object_table" = 'application profile'
		AND "trigger_name" = 'application profile_trigger_update_modified_at'
	) THEN
		CREATE TRIGGER "application profile_trigger_update_modified_at"
		BEFORE UPDATE ON "application profile"
		FOR EACH ROW
		EXECUTE PROCEDURE "trigger_update_modified_at"();
	END IF;
END;
$$;
