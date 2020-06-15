CREATE TABLE IF NOT EXISTS "organization" (
	"created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	"name" VARCHAR(255) NOT NULL
,	"handle" VARCHAR(255) NOT NULL UNIQUE
);

DO
$$
BEGIN
IF NOT EXISTS(
	SELECT 1
	FROM "information_schema"."triggers"
	WHERE "event_object_table" = 'organization'
	AND "trigger_name" = 'organization_trigger_update_modified_at'
) THEN
	CREATE TRIGGER "organization_trigger_update_modified_at"
	BEFORE UPDATE ON "organization"
	FOR EACH ROW
	EXECUTE PROCEDURE "trigger_update_modified_at"();
END IF;
END;
$$

CREATE TABLE IF NOT EXISTS "organization membership" (
	"created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"user" INTEGER NOT NULL
,	"is member of-organization" INTEGER NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	FOREIGN KEY ("user") REFERENCES "user" ("id")
,	FOREIGN KEY ("is member of-organization") REFERENCES "organization" ("id")
,	UNIQUE("user", "is member of-organization")
);

DO
$$
BEGIN
IF NOT EXISTS(
	SELECT 1
	FROM "information_schema"."triggers"
	WHERE "event_object_table" = 'organization membership'
	AND "trigger_name" = 'organization membership_trigger_update_modified_at'
) THEN
	CREATE TRIGGER "organization membership_trigger_update_modified_at"
	BEFORE UPDATE ON "organization membership"
	FOR EACH ROW
	EXECUTE PROCEDURE "trigger_update_modified_at"();
END IF;
END;
$$

ALTER TABLE "application"
ADD COLUMN "organization" INTEGER NULL,
ADD CONSTRAINT "application_organization_fkey"
	FOREIGN KEY ("organization")
	REFERENCES "organization" ("id");

INSERT INTO "organization" ("name", "handle")
SELECT 'admin', 'admin'
WHERE NOT EXISTS (
	SELECT "id"
	FROM "organization"
	WHERE "handle" = 'admin'
);

INSERT INTO "organization membership" (
	"user",
	"is member of-organization"
)
SELECT u."id", o."id"
FROM "user" u, "organization" o
WHERE u."username" = 'admin'
	AND o."handle" = 'admin'
	AND NOT EXISTS (
			SELECT 1
			FROM "organization membership" om
			WHERE om."user" = u."id"
				AND om."is member of-organization" = o."id"
	);

UPDATE "application" SET
	"organization" = (SELECT "id" FROM "organization" WHERE "handle" = 'admin'),
	"slug" = 'admin/' || lower("application"."app name")
WHERE "organization" is NULL;

ALTER TABLE "application" ALTER COLUMN "organization" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "organization_membership_is_member_of_organization_idx"
ON "organization membership" ("is member of-organization");

CREATE INDEX IF NOT EXISTS "application_organization_idx"
ON "application" ("organization");
