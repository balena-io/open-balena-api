ALTER TABLE "release"
ALTER COLUMN "release type" SET DEFAULT 'draft',
ALTER COLUMN "is passing tests" SET DEFAULT 0;

ALTER TABLE "application"
ALTER COLUMN "should track latest release" TYPE TEXT USING "should track latest release"::TEXT;

UPDATE "application"
SET "should track latest release" = 'none'
WHERE "should track latest release" = '0';

UPDATE "application"
SET "should track latest release" = 'any'
WHERE "should track latest release" = '1';
