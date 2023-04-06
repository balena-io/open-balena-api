UPDATE "release" SET "status" = 'failed' WHERE "id" IN (
  SELECT "release.1"."id"
  FROM "image" AS "image.0",
    "release" AS "release.1",
    "image-is part of-release" AS "image.0-is part of-release.1"
  WHERE 'success' = "release.1"."status"
  AND "release.1"."status" IS NOT NULL
  AND "image.0-is part of-release.1"."image" = "image.0"."id"
  AND "image.0-is part of-release.1"."is part of-release" = "release.1"."id"
  AND NOT (
    'success' = "image.0"."status"
    AND "image.0"."status" IS NOT NULL
  )
  -- As a precaution, exclude releases that `should be-running` on any device,
  -- as it's invalid for non-successful releases to be running on devices.
  -- There's no simple way to handle these cases so leave them alone, we'll fail
  -- the migration when the check below runs. Thankfully we don't have such data
  -- on balenaCloud and it's *extremely* unlikely other installations do, but it
  -- never hurts to be cautious in a data migration.
  AND NOT EXISTS (
    SELECT 1
    FROM "device" AS "d"
    WHERE "d"."should be running-release" = "release.1"."id"
  )
);

DO $$
BEGIN
  -- Check that the DB is in a valid state and raise an exception if that's not the case
  IF (
    SELECT COUNT(*)
    FROM "image" AS "image.0",
      "release" AS "release.1",
      "image-is part of-release" AS "image.0-is part of-release.1"
    WHERE 'success' = "release.1"."status"
    AND "release.1"."status" IS NOT NULL
    AND "image.0-is part of-release.1"."image" = "image.0"."id"
    AND "image.0-is part of-release.1"."is part of-release" = "release.1"."id"
    AND NOT (
      'success' = "image.0"."status"
      AND "image.0"."status" IS NOT NULL
    )
  ) > 0
  THEN
    RAISE EXCEPTION 'migration failed: It is necessary that each image that is part of a release that has a status that equals "success", has a status that equals "success".';
  END IF;
END $$;
