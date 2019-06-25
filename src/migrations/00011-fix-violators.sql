UPDATE "application" AS "application.0"
SET "commit" = NULL
WHERE "application.0"."commit" IS NOT NULL
AND EXISTS (
		SELECT 1
		FROM "release" AS "release.2"
		WHERE "release.2"."commit" = "application.0"."commit"
		AND "release.2"."commit" IS NOT NULL
		AND "release.2"."belongs to-application" = "application.0"."id"
)
AND NOT EXISTS (
		SELECT 1
		FROM "release" AS "release.4"
		WHERE "release.4"."commit" = "application.0"."commit"
		AND "release.4"."commit" IS NOT NULL
		AND "release.4"."status" = 'success'
		AND "release.4"."status" IS NOT NULL
		AND "release.4"."belongs to-application" = "application.0"."id"
);
