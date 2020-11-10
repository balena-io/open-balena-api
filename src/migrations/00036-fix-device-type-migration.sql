-- Migration 00016 should have dropped the "device type" column from the
-- application and device tables. It has since been retro-actively patched
-- to ensure its correctness, but in order for current installations to
-- reach the same state, a new separate migration must be executed that
-- drops the columns if they exist. This one does exactly that.

ALTER TABLE "application" DROP COLUMN IF EXISTS "device type";
ALTER TABLE "device" DROP COLUMN IF EXISTS "device type";
