ALTER TABLE "application"
ADD COLUMN "should be running-release" INTEGER NULL,
ADD CONSTRAINT "application_should be running-release_fkey" FOREIGN KEY ("should be running-release") REFERENCES "release" ("id");

UPDATE "application" a
SET "should be running-release" = (
	SELECT "id"
	FROM "release" r
	WHERE r."commit" = a."commit"
	AND r."belongs to-application" = a."id"
	AND r."status" = 'success'
)
WHERE "commit" IS NOT NULL;

ALTER TABLE "application"
DROP COLUMN "commit";

ALTER TABLE "device"
ADD COLUMN "is running-release" INTEGER NULL,
ADD CONSTRAINT "device_is running-release_fkey" FOREIGN KEY ("is running-release") REFERENCES "release" ("id");

UPDATE "device" d
SET "is running-release" = (
	SELECT "id"
	FROM "release" r
	WHERE r."commit" = d."is on-commit"
	AND r."belongs to-application" = d."belongs to-application"
	AND r."status" = 'success'
)
WHERE "is on-commit" IS NOT NULL;

ALTER TABLE "device"
DROP COLUMN "is on-commit";
