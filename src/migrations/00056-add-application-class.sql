ALTER TABLE "application"
ADD COLUMN IF NOT EXISTS "is of-class" VARCHAR(255) NOT NULL CHECK ("is of-class" IN ('fleet', 'block', 'app')) DEFAULT 'fleet';
