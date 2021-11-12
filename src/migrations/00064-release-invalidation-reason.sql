ALTER TABLE "release"
ADD COLUMN IF NOT EXISTS "invalidation reason" TEXT NULL;

DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'release'
			AND tc.constraint_name = 'release$RcddhgkY+99IgKXAUId7Q3iN4WylzgAxSFiF+JvyRiY='
	) THEN
		ALTER TABLE "release"
			-- It is necessary that each release that has an invalidation reason, is invalidated.
			ADD CONSTRAINT "release$RcddhgkY+99IgKXAUId7Q3iN4WylzgAxSFiF+JvyRiY=" CHECK (NOT (
				"invalidation reason" IS NOT NULL
				AND "is invalidated" != 1
			))
		;
	END IF;
END;
$$;
