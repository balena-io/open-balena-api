CREATE TABLE IF NOT EXISTS "image profile" (
	"created at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"release image" INTEGER NOT NULL
,	"profile name" VARCHAR(255) NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	FOREIGN KEY ("release image") REFERENCES "image-is part of-release" ("id")
,	UNIQUE("release image", "profile name")
,	-- It is necessary that each image profile has a profile name that has a Length (Type) that is greater than 0 and is less than or equal to 100.
CONSTRAINT "image profile$JNq7JtNpsLLnjhmNEfxBOCEqui7N5rB4gZp5QGt4bvs=" CHECK (0 < LENGTH("profile name")
AND LENGTH("profile name") <= 100
AND LENGTH("profile name") IS NOT NULL
AND "profile name" IS NOT NULL)
);

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
,	-- It is necessary that each application profile has a profile name that has a Length (Type) that is greater than 0 and is less than or equal to 100.
CONSTRAINT "application profile$RLsm+plcgv5chOijFdfezmde8H800RSDdEcmcYYlUzM" CHECK (0 < LENGTH("activates-profile name")
AND LENGTH("activates-profile name") <= 100
AND LENGTH("activates-profile name") IS NOT NULL
AND "activates-profile name" IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS "device profile" (
	"created at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"device" INTEGER NOT NULL
,	"activates-profile name" VARCHAR(255) NOT NULL
,	"on-application" INTEGER NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	FOREIGN KEY ("device") REFERENCES "device" ("id")
,	FOREIGN KEY ("on-application") REFERENCES "application" ("id")
,	UNIQUE("device", "activates-profile name", "on-application")
,	-- It is necessary that each device profile has a profile name that has a Length (Type) that is greater than 0 and is less than or equal to 100.
CONSTRAINT "device profile$uIGbagOmDbbG9dHHnnp7eT5eWRMBPdJc4X+POtluXzw=" CHECK (0 < LENGTH("activates-profile name")
AND LENGTH("activates-profile name") <= 100
AND LENGTH("activates-profile name") IS NOT NULL
AND "activates-profile name" IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS "device profile override" (
	"created at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"device" INTEGER NOT NULL
,	"overrides profiles on-application" INTEGER NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	FOREIGN KEY ("device") REFERENCES "device" ("id")
,	FOREIGN KEY ("overrides profiles on-application") REFERENCES "application" ("id")
,	UNIQUE("device", "overrides profiles on-application")
);

DO
$$
BEGIN
	IF NOT EXISTS(
		SELECT 1
		FROM "information_schema"."triggers"
		WHERE "event_object_table" = 'image profile'
		AND "trigger_name" = 'image profile_trigger_update_modified_at'
	) THEN
		CREATE TRIGGER "image profile_trigger_update_modified_at"
		BEFORE UPDATE ON "image profile"
		FOR EACH ROW
		EXECUTE PROCEDURE "trigger_update_modified_at"();
	END IF;

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

	IF NOT EXISTS(
		SELECT 1
		FROM "information_schema"."triggers"
		WHERE "event_object_table" = 'device profile'
		AND "trigger_name" = 'device profile_trigger_update_modified_at'
	) THEN
		CREATE TRIGGER "device profile_trigger_update_modified_at"
		BEFORE UPDATE ON "device profile"
		FOR EACH ROW
		EXECUTE PROCEDURE "trigger_update_modified_at"();
	END IF;

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
