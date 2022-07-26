ALTER TABLE "release"
ADD COLUMN IF NOT EXISTS "phase" VARCHAR(255) NULL CHECK ("phase" IN ('next', 'current', 'sunset', 'end-of-life'));
