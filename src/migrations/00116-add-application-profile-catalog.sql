CREATE TABLE IF NOT EXISTS "application profile catalog" (
	"created at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"application" INTEGER NOT NULL
,	"catalogs-profile name" VARCHAR(255) NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	"description" TEXT NULL
,	FOREIGN KEY ("application") REFERENCES "application" ("id")
,	UNIQUE("application", "catalogs-profile name")
,	-- It is necessary that each application profile catalog has a profile name that has a Length (Type) that is greater than 1 and is less than or equal to 100.
CONSTRAINT "application profile catalog$VXyZ0t6cvdG01P73PQfgOUt24NeJpYKIkvw" CHECK (1 < LENGTH("catalogs-profile name")
AND LENGTH("catalogs-profile name") <= 100
AND LENGTH("catalogs-profile name") IS NOT NULL
AND "catalogs-profile name" IS NOT NULL)
,	-- It is necessary that each application profile catalog that has a description (Auth), has a description (Auth) that has a Length (Type) that is less than or equal to 4000.
CONSTRAINT "application profile catalog$YaOngRUEm3Tq4MmxLI37sOW5uiFZDS+Imjc" CHECK (NOT (
	"description" IS NOT NULL
	AND NOT (
		LENGTH("description") <= 4000
		AND LENGTH("description") IS NOT NULL
		AND "description" IS NOT NULL
	)
))
);

DO
$$
BEGIN
	IF NOT EXISTS(
		SELECT 1
		FROM "information_schema"."triggers"
		WHERE "event_object_table" = 'application profile catalog'
		AND "trigger_name" = 'application profile catalog_trigger_update_modified_at'
	) THEN
		CREATE TRIGGER "application profile catalog_trigger_update_modified_at"
		BEFORE UPDATE ON "application profile catalog"
		FOR EACH ROW
		EXECUTE PROCEDURE "trigger_update_modified_at"();
	END IF;
END;
$$;
