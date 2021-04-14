ALTER TABLE "application"
ADD COLUMN IF NOT EXISTS "is public" INT NOT NULL DEFAULT 0;

ALTER TABLE "device"
ADD COLUMN IF NOT EXISTS "is initialized by-release" INT NULL;
