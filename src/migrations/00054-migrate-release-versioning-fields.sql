-- Draft releases are represented as having NULL revision
UPDATE "release"
SET "revision" = NULL
WHERE "release type" = 'draft';

UPDATE "release"
SET "is finalized at-date" = "release"."created_at"
WHERE "release_type" = 'final'
	AND "is finalized at-date" IS NULL;

-- Parse (best effort) the release version and split it into semver parts with an increasing revision for identical semvers.
WITH "revisioned release" AS (
	SELECT splitedReleaseVersion."id",
		COALESCE(splitedReleaseVersion."semver major", 0) AS "semver major",
		COALESCE(splitedReleaseVersion."semver minor", 0) AS "semver minor",
		COALESCE(splitedReleaseVersion."semver patch", 0) AS "semver patch",
		(ROW_NUMBER() OVER (
			PARTITION BY splitedReleaseVersion."belongs to-application",
				COALESCE(splitedReleaseVersion."semver major", 0),
				COALESCE(splitedReleaseVersion."semver minor", 0),
				COALESCE(splitedReleaseVersion."semver patch", 0)
			ORDER BY splitedReleaseVersion."is finalized at-date" ASC,
				splitedReleaseVersion."id" ASC
		) - 1) AS "revision"
	FROM (
		SELECT r0."id",
			r0."is finalized at-date",
			r0."belongs to-application",
			CAST((REGEXP_MATCHES (r0."release version", '^v?([0-9]+)(\.[0-9]+(\.[0-9]+)?)?'))[1] AS INTEGER) AS "semver major",
			CAST((REGEXP_MATCHES (r0."release version", '^v?[0-9]+\.([0-9]+)(\.[0-9]+)?'))[1] AS INTEGER) AS "semver minor",
			CAST((REGEXP_MATCHES (r0."release version", '^v?[0-9]+\.[0-9]+\.([0-9]+)'))[1] AS INTEGER) AS "semver patch"
		FROM "release" r0
		WHERE r0."release type" = 'final'
			AND r0."release version" SIMILAR TO 'v?[0-9]+(\.[0-9]+(\.[0-9]+(_logstream[0-9]?)?)?)?'
	) AS splitedReleaseVersion
)
UPDATE "release" r  SET
	"semver major" = rr."semver major",
	"semver minor" = rr."semver minor",
	"semver patch" = rr."semver patch",
	r."revision" = rr."revision"
FROM "revisioned release" rr
WHERE r."id" = rr."id";

-- For release versions that are empty or can't be parsed or were parsed as 0.0.0, set 0.0.0 as the semver and increase the revision.
WITH "revisioned release" AS (
	SELECT r0."id",
		(ROW_NUMBER() OVER (
			PARTITION BY r0."belongs to-application"
			ORDER BY r0."is finalized at-date" ASC, r0."id" ASC
		) - 1) AS "revision"
	FROM "release" r0
	WHERE r0."release type" = 'final'
		AND (
			r0."release version" IS NULL
			OR r0."release version" NOT SIMILAR TO 'v?[0-9]+(\.[0-9]+(\.[0-9]+(_logstream[0-9]?)?)?)?'
			OR (
				r0."semver major" = 0
				AND r0."semver minor" = 0
				AND r0."semver patch" = 0
			)
		)
)
UPDATE "release" r  SET
	"semver major" = 0,
	"semver minor" = 0,
	"semver patch" = 0,
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
