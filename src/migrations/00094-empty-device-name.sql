UPDATE "device" SET
	"device name" = ''
WHERE "device name" IS NULL;

ALTER TABLE "device"
ALTER COLUMN "device name" SET NOT NULL;

UPDATE