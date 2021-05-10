
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "application" AS "application.0"
		WHERE "application.0"."is public" = 1
		AND NOT EXISTS (
			SELECT 1
			FROM "application type" AS "application type.1"
			WHERE "application type.1"."is legacy" = 0
			AND "application.0"."application type" = "application type.1"."id"
		)
	)
	THEN
		RAISE EXCEPTION 'migration failed: It is necessary that each application that is public, has an application type that is not legacy.';
	END IF;
END $$;
