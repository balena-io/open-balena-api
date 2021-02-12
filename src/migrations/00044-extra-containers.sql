-- migrate to add a new public flag value to the application model...
ALTER TABLE "application"
ADD COLUMN IF NOT EXISTS "is public" INT NOT NULL DEFAULT 0;

-- migrate to add a new install type value to the application model...
ALTER TABLE "application"
ADD COLUMN IF NOT EXISTS "install type" VARCHAR(255) NULL DEFAULT 'supervised';

-- migrate to add a should be managed by-release relationship to the devices...
ALTER TABLE "device"
ADD COLUMN IF NOT EXISTS "should be managed by-release" INT NULL;

