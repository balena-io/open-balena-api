ALTER TABLE "device service environment variable"
ADD COLUMN IF NOT EXISTS "device" INTEGER NULL;

ALTER TABLE "device service environment variable"
ADD COLUMN IF NOT EXISTS "service" INTEGER NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "device service environment variable_device_service_name_key"
ON "device service environment variable" ("device", "service", "name");

DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints AS tc
		JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name
		WHERE tc.constraint_type = 'FOREIGN KEY'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'device service environment variable'
			AND kcu.column_name = 'device'
	) THEN
		ALTER TABLE "device service environment variable"
		ADD CONSTRAINT "device service environment variable_device_fkey" 
		FOREIGN KEY ("device") REFERENCES "device" ("id");
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints AS tc
		JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name
		WHERE tc.constraint_type = 'FOREIGN KEY'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'device service environment variable'
			AND kcu.column_name = 'service'
	) THEN
		ALTER TABLE "device service environment variable"
		ADD CONSTRAINT "device service environment variable_service_fkey" 
		FOREIGN KEY ("service") REFERENCES "service" ("id");
	END IF;
END;
$$;
