ALTER TABLE "release"
ADD COLUMN IF NOT EXISTS "semver prerelease" VARCHAR(255) NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS "semver build" VARCHAR(255) NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS "release_belongs_to_app_revision_semver_prerelease_idx"
ON "release" ("belongs to-application", "revision", "semver major", "semver minor", "semver patch", "semver prerelease");
