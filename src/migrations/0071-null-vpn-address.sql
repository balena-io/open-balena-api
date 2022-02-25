UPDATE "device"
SET "vpn address" = NULL
WHERE "vpn address" IS NOT NULL;
