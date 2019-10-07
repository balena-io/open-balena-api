-- Text enum to hold the state of the API heartbeat
-- values: online, offline, timeout, unknown
-- default: unknown

ALTER TABLE "device" ADD COLUMN "api heartbeat state" VARCHAR(255) NOT NULL DEFAULT 'unknown';
