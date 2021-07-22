-- Draft releases are now represented with a NULL revision
UPDATE "release"
SET "revision" = NULL
WHERE "release type" = 'draft'
	AND "revision" IS NOT NULL;

UPDATE "release"
SET "is finalized at-date" = "release"."created_at"
WHERE "release_type" = 'final'
	AND "is finalized at-date" IS NULL;

-- Parse the release version (best effort) and split it into semver parts with an increasing revision for identical semvers.
-- The _logstream variants & 4digit versions will get a higher revision b/c they where created later than the base version.
-- For release versions that are empty or can't be parsed or were parsed as 0.0.0, set 0.0.0 as the semver and increase the revision.
WITH "parsed version release" AS (
	SELECT parsedVersionRelease."id",
		parsedVersionRelease."is finalized at-date",
		parsedVersionRelease."belongs to-application",
		-- Had to be a separate SELECT b/c we can't COALESCE REGEXP_MATCHES in the same SELECT.
		COALESCE(parsedVersionRelease."semver major", 0) AS "semver major",
		COALESCE(parsedVersionRelease."semver minor", 0) AS "semver minor",
		COALESCE(parsedVersionRelease."semver patch", 0) AS "semver patch"
	FROM (
		SELECT r0."id",
			r0."is finalized at-date",
			r0."belongs to-application",
			CAST((REGEXP_MATCHES (r0."release version", '^v?([0-9]+)(\.[0-9]+(\.[0-9]+)?)?'))[1] AS INTEGER) AS "semver major",
			CAST((REGEXP_MATCHES (r0."release version", '^v?[0-9]+\.([0-9]+)(\.[0-9]+)?'))[1] AS INTEGER) AS "semver minor",
			CAST((REGEXP_MATCHES (r0."release version", '^v?[0-9]+\.[0-9]+\.([0-9]+)'))[1] AS INTEGER) AS "semver patch"
		FROM "release" r0
		WHERE r0."release type" = 'final'
			AND r0."release version" SIMILAR TO 'v?[0-9]+(\.[0-9]+(\.[0-9]+(\.[0-9]+)?(_logstream[0-9]?)?)?)?'
	) AS parsedVersionRelease
),
"revisioned release" AS (
	SELECT splitedReleaseVersion."id",
		splitedReleaseVersion."semver major",
		splitedReleaseVersion."semver minor",
		splitedReleaseVersion."semver patch",
		(ROW_NUMBER() OVER (
			PARTITION BY splitedReleaseVersion."belongs to-application",
				splitedReleaseVersion."semver major",
				splitedReleaseVersion."semver minor",
				splitedReleaseVersion."semver patch"
			ORDER BY
				splitedReleaseVersion."is finalized at-date" ASC,
				splitedReleaseVersion."id" ASC
		) - 1) AS "revision"
	FROM (
		SELECT pvr."id",
			pvr."is finalized at-date",
			pvr."belongs to-application",
			pvr."semver major",
			pvr."semver minor",
			pvr."semver patch"
		FROM "parsed version release" pvr
		UNION ALL
		SELECT unparsedRelease."id",
			unparsedRelease."is finalized at-date",
			unparsedRelease."belongs to-application",
			0 AS "semver major",
			0 AS "semver minor",
			0 AS "semver patch"
		FROM "release" unparsedRelease
		WHERE unparsedRelease."release type" = 'final'
			AND NOT EXISTS (
				SELECT 1
				FROM "parsed version release" pvr
				WHERE pvr."id" = unparsedRelease."id"
			)
	) AS splitedReleaseVersion
)
UPDATE "release" r  SET
	"semver major" = rr."semver major",
	"semver minor" = rr."semver minor",
	"semver patch" = rr."semver patch",
	r."revision" = rr."revision"
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
