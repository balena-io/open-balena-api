DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'device type'
			AND tc.constraint_name = 'device type$shKCrzikfjtnX070rB6v8LwC9rQCHtxUlRYxC/wLh1s='
	) THEN
		ALTER TABLE "device type" ADD CONSTRAINT "device type$shKCrzikfjtnX070rB6v8LwC9rQCHtxUlRYxC/wLh1s=" CHECK (NOT (
			"contract" IS NOT NULL
			AND NOT (
				LENGTH(CAST("contract" AS TEXT)) <= 5000000
				AND LENGTH(CAST("contract" AS TEXT)) IS NOT NULL
				AND CAST("contract" AS TEXT) IS NOT NULL
				AND "contract" IS NOT NULL
			)
		));
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'image'
			AND tc.constraint_name = 'image$nybC4iKkfDyMHL1XdO+jBh14yg2kL8EntCruE9ik01Q='
	) THEN
		ALTER TABLE "image" ADD CONSTRAINT "image$nybC4iKkfDyMHL1XdO+jBh14yg2kL8EntCruE9ik01Q=" CHECK (NOT (
			"contract" IS NOT NULL
			AND NOT (
				LENGTH(CAST("contract" AS TEXT)) <= 1000000
				AND LENGTH(CAST("contract" AS TEXT)) IS NOT NULL
				AND CAST("contract" AS TEXT) IS NOT NULL
				AND "contract" IS NOT NULL
			)
		));
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'release'
			AND tc.constraint_name = 'release$0BXXZu4RV1bypE5N8QmpCg0JyLsXLG2LAg4kPji2cHc='
	) THEN
		ALTER TABLE "release" ADD CONSTRAINT "release$0BXXZu4RV1bypE5N8QmpCg0JyLsXLG2LAg4kPji2cHc=" CHECK (
			LENGTH(CAST("composition" AS TEXT)) <= 1000000
			AND LENGTH(CAST("composition" AS TEXT)) IS NOT NULL
			AND CAST("composition" AS TEXT) IS NOT NULL
			AND "composition" IS NOT NULL
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'release'
			AND tc.constraint_name = 'release$MF7FkJuw+bWB+/NwDTBjBHYgtxiCO8wHS/2Nsx8wE3M='
	) THEN
		ALTER TABLE "release" ADD CONSTRAINT "release$MF7FkJuw+bWB+/NwDTBjBHYgtxiCO8wHS/2Nsx8wE3M=" CHECK (NOT (
			"contract" IS NOT NULL
			AND NOT (
				LENGTH(CAST("contract" AS TEXT)) <= 1000000
				AND LENGTH(CAST("contract" AS TEXT)) IS NOT NULL
				AND CAST("contract" AS TEXT) IS NOT NULL
				AND "contract" IS NOT NULL
			)
		));
	END IF;
	
	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'release asset'
			AND tc.constraint_name = 'release asset$n20df/3vR+3GaNU9J/1NnyfOB3CWMZvoFCc6mcuJdgQ='
	) THEN
		ALTER TABLE "release asset" ADD CONSTRAINT "release asset$n20df/3vR+3GaNU9J/1NnyfOB3CWMZvoFCc6mcuJdgQ=" CHECK (NOT (
			"asset" IS NOT NULL
			AND NOT (
				LENGTH("asset" #>> ARRAY['filename']) <= 255
				AND LENGTH("asset" #>> ARRAY['filename']) IS NOT NULL
				AND "asset" #>> ARRAY['filename'] IS NOT NULL
				AND LENGTH("asset" #>> ARRAY['content_type']) <= 129
				AND LENGTH("asset" #>> ARRAY['content_type']) IS NOT NULL
				AND "asset" #>> ARRAY['content_type'] IS NOT NULL
				AND "asset" IS NOT NULL
			)
		));
	END IF;
END;
$$;
