ALTER TABLE "device type table" RENAME TO "device type";

-- fix up application table

UPDATE "application"
SET "is for-device type table" = (
	SELECT "id"
	FROM "device type"
	WHERE "slug" = lower("application"."device type")
)
WHERE "is for-device type table" is NULL;

ALTER TABLE "application"
ALTER COLUMN "is for-device type table" SET NOT NULL;

ALTER TABLE "application"
RENAME COLUMN "is for-device type table" TO "is for-device type";

-- fix up device table

UPDATE "device"
SET "is of-device type table" = (
	SELECT "id"
	FROM "device type"
	WHERE "slug" = lower("device"."device type")
)
WHERE "is of-device type table" is NULL;

ALTER TABLE "device"
ALTER COLUMN "is of-device type table" SET NOT NULL;

ALTER TABLE "device"
RENAME COLUMN "is of-device type table" TO "is of-device type";
