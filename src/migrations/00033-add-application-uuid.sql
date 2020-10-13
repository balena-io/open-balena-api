-- load the UUID functions...
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- migrate to add a new UUID value to the application model...
ALTER TABLE "application"
ADD COLUMN IF NOT EXISTS "uuid" TEXT NOT NULL DEFAULT REPLACE(CAST(UUID_GENERATE_V4() AS TEXT), '-', ''),
ADD CONSTRAINT "application_uuid_key" UNIQUE ("uuid");

-- remove the default
ALTER TABLE "application"
ALTER COLUMN "uuid" DROP DEFAULT;
