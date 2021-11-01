DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "release" AS "release.0",
			"device" AS "device.1"
		WHERE "device.1"."should be managed by-release" = "release.0"."id"
		AND NOT (
			"release.0"."status" = 'success'
			AND "release.0"."status" IS NOT NULL
			AND (0 < "release.0"."semver major"
			AND "release.0"."semver major" IS NOT NULL
			OR 0 < "release.0"."semver minor"
			AND "release.0"."semver minor" IS NOT NULL
			OR 0 < "release.0"."semver patch"
			AND "release.0"."semver patch" IS NOT NULL)
		)
	)
	THEN
		RAISE EXCEPTION 'migration failed: It is necessary that each release that should manage a device, has a status that is equal to "success" and has a semver major that is greater than 0 or has a semver minor that is greater than 0 or has a semver patch that is greater than 0.';
	END IF;
END $$;
