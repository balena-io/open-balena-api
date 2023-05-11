-- Optimization for the app-release_version uniqueness rule,
-- while preserving the index for the deprecated release_version small.
CREATE INDEX IF NOT EXISTS "release_belongs_to_app_release_version_partial_idx"
ON "release" ("belongs to-application", "release version")
WHERE "release"."release version" IS NOT NULL;
