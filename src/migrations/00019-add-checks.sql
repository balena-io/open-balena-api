ALTER TABLE "device" ADD CONSTRAINT "device_api heartbeat state_check" CHECK ("api heartbeat state" IN ('online', 'offline', 'timeout', 'unknown'));
