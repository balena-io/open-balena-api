DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "release" AS "release.0",
			"device" AS "device.1"
		WHERE "device.1"."should be managed by-release" = "release.0"."id"
		AND NOT EXISTS (
			SELECT 1
			FROM "application" AS "application.2"
			WHERE "application.2"."is public" = 1
			AND "application.2"."is host" = 0
			AND "application.2"."slug" IN (
				'balena_os/aarch64-supervisor',
				'balena_os/amd64-supervisor',
				'balena_os/armv7hf-supervisor',
				'balena_os/i386-supervisor',
				'balena_os/i386-nlp-supervisor',
				'balena_os/rpi-supervisor'
			)
			AND "application.2"."slug" IS NOT NULL
			AND "release.0"."belongs to-application" = "application.2"."id"
		)
	)
	THEN
		RAISE EXCEPTION 'migration failed: It is necessary that each release that should manage a device, belongs to an application that is public and is not host and has a slug that is equal to "balena_os/aarch64-supervisor" or "balena_os/amd64-supervisor" or "balena_os/armv7hf-supervisor" or "balena_os/i386-supervisor" or "balena_os/i386-nlp-supervisor" or "balena_os/rpi-supervisor".';
	END IF;
END $$;
