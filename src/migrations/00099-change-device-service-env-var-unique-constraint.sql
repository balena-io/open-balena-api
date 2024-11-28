DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'device service environment variable_device_service_name_key'
    ) THEN
        ALTER TABLE "device service environment variable"
        ADD CONSTRAINT "device service environment variable_device_service_name_key"
        -- see migration 00095 which adds the index already on ("device", "service", "name")
        UNIQUE USING INDEX "device service environment variable_device_service_name_key";
    END IF;
END
$$;
