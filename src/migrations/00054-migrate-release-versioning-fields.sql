UPDATE "release"
SET "revision" = NULL
WHERE "release type" = 'draft'
	AND "revision" IS NOT NULL;

UPDATE "release"
SET "is finalized at-date" = "release"."created at"
WHERE "release type" = 'final'
	AND "is finalized at-date" IS NULL;

-- Parse the release version (best effort) and split it into semver parts with an increasing revision for identical semvers.
-- The _logstream variants & 4digit versions will get a higher revision b/c they where created later than the base version.
-- For release versions that are empty or can't be parsed or were parsed as 0.0.0, set 0.0.0 as the semver and increase the revision.
WITH "parsed version release" AS (
	SELECT r0."id",
		r0."belongs to-application", 
		CASE
			WHEN r0."release version" SIMILAR TO 'v?[0-9]+(.[0-9]+(.[0-9]+(.[0-9]+)?(_logstream[0-9]?)?)?)?' THEN
				COALESCE(CAST(SUBSTRING((STRING_TO_ARRAY(r0."release version", '.'))[1] FROM '[0-9]+') AS INTEGER), 0)
			ELSE 0
		END AS "new semver major",
		CASE
			WHEN r0."release version" SIMILAR TO 'v?[0-9]+(.[0-9]+(.[0-9]+(.[0-9]+)?(_logstream[0-9]?)?)?)?' THEN
				COALESCE(CAST(SUBSTRING((STRING_TO_ARRAY(r0."release version", '.'))[2] FROM '[0-9]+') AS INTEGER), 0)
			ELSE 0
		END AS "new semver minor",
		CASE
			WHEN r0."release version" SIMILAR TO 'v?[0-9]+(.[0-9]+(.[0-9]+(.[0-9]+)?(_logstream[0-9]?)?)?)?' THEN
				COALESCE(CAST(SUBSTRING((STRING_TO_ARRAY(r0."release version", '.'))[3] FROM '[0-9]+') AS INTEGER), 0)
			ELSE 0
		END AS "new semver patch" 
	FROM "release" r0
	WHERE r0."release type" = 'final'
	ORDER BY "belongs to-application",
		"new semver major",
		"new semver minor",
		"new semver patch",
		"id"
),
"revisioned release" AS (
	SELECT split."id",
		split."new semver major" AS "semver major",
		split."new semver minor" AS "semver minor",  
		split."new semver patch" AS "semver patch",
		(ROW_NUMBER() OVER (
			PARTITION BY split."belongs to-application", 
				split."new semver major",
				split."new semver minor",
				split."new semver patch"
			ORDER BY
				split."id" ASC
		) - 1) AS "revision"
	FROM "parsed version release" AS split
)
UPDATE "release" r  SET
	"semver major" = rr."semver major",
	"semver minor" = rr."semver minor",
	"semver patch" = rr."semver patch",
	"revision" = rr."revision"
FROM "revisioned release" rr
WHERE r."id" = rr."id";

DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "application" AS "application.0",
			"release" AS "release.1"
		WHERE "release.1"."revision" IS NOT NULL
		AND "release.1"."belongs to-application" = "application.0"."id"
		AND (
			SELECT COUNT(*)
			FROM "release" AS "release.3"
			WHERE "release.1"."semver major" = "release.3"."semver major"
			AND "release.3"."semver major" IS NOT NULL
			AND "release.1"."semver minor" = "release.3"."semver minor"
			AND "release.3"."semver minor" IS NOT NULL
			AND "release.1"."semver patch" = "release.3"."semver patch"
			AND "release.3"."semver patch" IS NOT NULL
			AND "release.1"."revision" = "release.3"."revision"
			AND "release.3"."revision" IS NOT NULL
			AND "release.3"."belongs to-application" = "application.0"."id"
		) >= 2
	)
	THEN
		RAISE EXCEPTION 'migration failed: It is necessary that each application that owns a release1 that has a revision, owns at most one release2 that has a semver major that is of the release1 and has a semver minor that is of the release1 and has a semver patch that is of the release1 and has a revision that is of the release1.';
	END IF;
END $$;
