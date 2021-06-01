DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		JOIN information_schema.constraint_column_usage ccu USING (constraint_catalog, constraint_schema, constraint_name)
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'release'
			AND ccu.table_schema = CURRENT_SCHEMA()
			AND ccu.column_name = 'release type'
			AND ccu.constraint_name = 'release_release type_check'
	) THEN
		IF EXISTS (
			SELECT 1
			FROM "release"
			WHERE "release type" NOT IN ('final', 'draft')
		)
		THEN
			RAISE EXCEPTION 'migration failed: It is necessary that each release has a release type that is "final" or "draft".';
		END IF;

		ALTER TABLE "release"
		ADD CONSTRAINT "release_release type_check" CHECK ("release type" IN ('final', 'draft'));
	END IF;
END $$;
