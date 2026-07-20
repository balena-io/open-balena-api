CREATE TABLE IF NOT EXISTS "image profile" (
	"created at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"release image" INTEGER NOT NULL
,	"profile name" VARCHAR(255) NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	FOREIGN KEY ("release image") REFERENCES "image-is part of-release" ("id")
,	UNIQUE("release image", "profile name")
,	-- It is necessary that each image profile has a profile name that has a Length (Type) that is greater than 1 and is less than or equal to 100.
CONSTRAINT "image profile$ZSV3jtn+ngalOuEdfnLpQPXQaYV2hpBKYqBj3p8V4aQ=" CHECK (1 < LENGTH("profile name")
AND LENGTH("profile name") <= 100
AND LENGTH("profile name") IS NOT NULL
AND "profile name" IS NOT NULL)
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
END;
$$;
