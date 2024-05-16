-- Add the column if it does not exist
ALTER TABLE "device"
ADD COLUMN IF NOT EXISTS "is pinned on-release" INTEGER NULL;

-- Add an index for optimization if it does not exist
CREATE INDEX IF NOT EXISTS "device_is_pinned_on_release_application_idx"
ON "device" ("is pinned on-release", "belongs to-application");

-- Check and add the foreign key constraint conditionally
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY'
            AND tc.table_schema = CURRENT_SCHEMA()
            AND tc.table_name = 'device'
            AND kcu.column_name = 'is pinned on-release'
    ) THEN
        ALTER TABLE "device"
        ADD CONSTRAINT "device_is pinned on-release_fkey" FOREIGN KEY ("is pinned on-release") REFERENCES "release" ("id");
    END IF;
END;
$$;
