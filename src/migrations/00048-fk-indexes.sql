CREATE INDEX IF NOT EXISTS "api_key_has_role_role_idx"
ON "api key-has-role" ("role");

CREATE INDEX IF NOT EXISTS "api_key_has_permission_permission_idx"
ON "api key-has-permission" ("permission");

CREATE INDEX IF NOT EXISTS "device_family_manufacturer_idx"
ON "device family" ("is manufactured by-device manufacturer");

CREATE INDEX IF NOT EXISTS "device_type_cpu_arch_idx"
ON "device type" ("is of-cpu architecture");
CREATE INDEX IF NOT EXISTS "device_type_device_family_idx"
ON "device type" ("belongs to-device family");

CREATE INDEX IF NOT EXISTS "role_has_permission_permission_idx"
ON "role-has-permission" ("permission");

CREATE INDEX IF NOT EXISTS "user_has_permission_permission_idx"
ON "user-has-permission" ("permission");

CREATE INDEX IF NOT EXISTS "user_has_role_role_idx"
ON "user-has-role" ("role");
