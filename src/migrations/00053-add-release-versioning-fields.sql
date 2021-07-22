ALTER TABLE "release"
ADD COLUMN IF NOT EXISTS "is finalized at-date" TIMESTAMP NULL,
ADD COLUMN IF NOT EXISTS "semver major" INTEGER DEFAULT 0 NOT NULL,
ADD COLUMN IF NOT EXISTS "semver minor" INTEGER DEFAULT 0 NOT NULL,
ADD COLUMN IF NOT EXISTS "semver patch" INTEGER DEFAULT 0 NOT NULL,
ADD COLUMN IF NOT EXISTS "revision" INTEGER NULL;

UPDATE "release"
SET "is finalized at-date" = "release"."created_at"
WHERE "release_type" = 'final';

DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'release'
			AND tc.constraint_name = 'release$69zgYrVSJaN1avGiEeipPlJ9/lMKzOIt3iMPF6u/6WY='
	) THEN
		ALTER TABLE "release"
			-- It is necessary that each release that has a revision, has a revision that is greater than or equal to 0.
			ADD CONSTRAINT "release$69zgYrVSJaN1avGiEeipPlJ9/lMKzOIt3iMPF6u/6WY=" CHECK (NOT (
				"revision" IS NOT NULL
				AND NOT (
					0 <= "revision"
					AND "revision" IS NOT NULL
				)
			))
		;
	END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS "release_belongs_to_app_revision_semver_idx"
ON "release" ("belongs to-application", "revision", "semver major", "semver minor", "semver patch");
