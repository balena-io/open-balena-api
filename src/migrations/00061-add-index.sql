-- Optimizes device api key permission lookups that check both the device actor and application, particularly noticeable for the device state endpoint
CREATE INDEX IF NOT EXISTS "device_application_actor_idx"
ON "device" ("belongs to-application", "actor");
