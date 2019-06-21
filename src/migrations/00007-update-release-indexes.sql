CREATE INDEX IF NOT EXISTS "release_application_commit_status_idx"
ON "release" ("belongs to-application", "commit", "status");

DROP INDEX IF EXISTS "release_application_idx";
DROP INDEX IF EXISTS "release_commit_idx";
DROP INDEX IF EXISTS "release_status_idx";
