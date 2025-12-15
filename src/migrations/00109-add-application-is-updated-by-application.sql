-- Add the column if it does not exist
ALTER TABLE "application"
ADD COLUMN IF NOT EXISTS "is updated by-application" INTEGER NULL;

-- Add an index for optimization if it does not exist
CREATE INDEX IF NOT EXISTS "application_is_updated_by_application_idx"
ON "application" ("is updated by-application");

-- Check and add the foreign key constraint conditionally
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints AS tc
		JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name
		WHERE tc.constraint_type = 'FOREIGN KEY'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'application'
			AND kcu.column_name = 'is updated by-application'
	) THEN
		ALTER TABLE "application"
		ADD CONSTRAINT "application_is updated by-application_fkey" FOREIGN KEY ("is updated by-application") REFERENCES application ("id");
	END IF;
END;
$$;
