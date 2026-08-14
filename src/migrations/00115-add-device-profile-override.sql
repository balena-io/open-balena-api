CREATE TABLE IF NOT EXISTS "device profile override" (
	"created at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"device" INTEGER NOT NULL
,	"overrides-profile name" VARCHAR(255) NOT NULL
,	"on-application" INTEGER NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	"is active" BOOLEAN DEFAULT FALSE NOT NULL
,	FOREIGN KEY ("device") REFERENCES "device" ("id")
,	FOREIGN KEY ("on-application") REFERENCES "application" ("id")
,	UNIQUE("device", "overrides-profile name", "on-application")
,	-- It is necessary that each device profile override has a profile name that has a Length (Type) that is greater than 1 and is less than or equal to 100.
CONSTRAINT "device profile override$4IQoYl4sSKpj7XIAC5UG/vrecsyzot8Yo8n6W/P" CHECK (1 < LENGTH("overrides-profile name")
AND LENGTH("overrides-profile name") <= 100
AND LENGTH("overrides-profile name") IS NOT NULL
AND "overrides-profile name" IS NOT NULL)
);

DO
$$
BEGIN
	IF NOT EXISTS(
		SELECT 1
		FROM "information_schema"."triggers"
		WHERE "event_object_table" = 'device profile override'
		AND "trigger_name" = 'device profile override_trigger_update_modified_at'
	) THEN
		CREATE TRIGGER "device profile override_trigger_update_modified_at"
		BEFORE UPDATE ON "device profile override"
		FOR EACH ROW
		EXECUTE PROCEDURE "trigger_update_modified_at"();
	END IF;
END;
$$;
