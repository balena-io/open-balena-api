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

-- `device profile` is a bare Term (own serial id, no defining fact) with `device`/`application`
-- mandatory and `profile name` nullable -- a NULL row means "device overrides `application`'s
-- fleet default with nothing active". SBVR can't express nullability for a field that's part of
-- the fact that *defines* a Term Form, so unlike `application profile` this can't be a plain
-- Term Form; the length check and both uniqueness constraints (one active profile name per
-- (device, application); at most one NULL-profile-name row per (device, application)) are
-- enforced as SBVR Rules/necessities instead of table CHECK/UNIQUE constraints -- see
-- src/balena.sbvr's "device profile" block and the two device-profile Rules near the end.
CREATE TABLE IF NOT EXISTS "device profile" (
	"created at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	"device" INTEGER NOT NULL
,	"application" INTEGER NOT NULL
,	"profile name" VARCHAR(255)
,	FOREIGN KEY ("device") REFERENCES "device" ("id")
,	FOREIGN KEY ("application") REFERENCES "application" ("id")
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
END;
$$;
