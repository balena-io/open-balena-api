--
-- Create table statements
--

DO $$
BEGIN
	PERFORM '"trigger_update_modified_at"()'::regprocedure;
EXCEPTION WHEN undefined_function THEN
	CREATE FUNCTION "trigger_update_modified_at"()
	RETURNS TRIGGER AS $fn$
	BEGIN
		NEW."modified at" = NOW();
RETURN NEW;
	END;
	$fn$ LANGUAGE plpgsql;
END;
$$;

CREATE TABLE IF NOT EXISTS "actor" (
	"created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
);

DO
$$
BEGIN
IF NOT EXISTS(
	SELECT 1
	FROM "information_schema"."triggers"
	WHERE "event_object_table" = 'actor'
	AND "trigger_name" = 'actor_trigger_update_modified_at'
) THEN
	CREATE TRIGGER "actor_trigger_update_modified_at"
	BEFORE UPDATE ON "actor"
	FOR EACH ROW
	EXECUTE PROCEDURE "trigger_update_modified_at"();
END IF;
END;
$$

CREATE TABLE IF NOT EXISTS "permission" (
	"created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	"name" VARCHAR(255) NOT NULL UNIQUE
);

DO
$$
BEGIN
IF NOT EXISTS(
	SELECT 1
	FROM "information_schema"."triggers"
	WHERE "event_object_table" = 'permission'
	AND "trigger_name" = 'permission_trigger_update_modified_at'
) THEN
	CREATE TRIGGER "permission_trigger_update_modified_at"
	BEFORE UPDATE ON "permission"
	FOR EACH ROW
	EXECUTE PROCEDURE "trigger_update_modified_at"();
END IF;
END;
$$

CREATE TABLE IF NOT EXISTS "role" (
	"created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	"name" VARCHAR(255) NOT NULL UNIQUE
);

DO
$$
BEGIN
IF NOT EXISTS(
	SELECT 1
	FROM "information_schema"."triggers"
	WHERE "event_object_table" = 'role'
	AND "trigger_name" = 'role_trigger_update_modified_at'
) THEN
	CREATE TRIGGER "role_trigger_update_modified_at"
	BEFORE UPDATE ON "role"
	FOR EACH ROW
	EXECUTE PROCEDURE "trigger_update_modified_at"();
END IF;
END;
$$

CREATE TABLE IF NOT EXISTS "role-has-permission" (
	"created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"role" INTEGER NOT NULL
,	"permission" INTEGER NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	FOREIGN KEY ("role") REFERENCES "role" ("id")
,	FOREIGN KEY ("permission") REFERENCES "permission" ("id")
,	UNIQUE("role", "permission")
);

DO
$$
BEGIN
IF NOT EXISTS(
	SELECT 1
	FROM "information_schema"."triggers"
	WHERE "event_object_table" = 'role-has-permission'
	AND "trigger_name" = 'role-has-permission_trigger_update_modified_at'
) THEN
	CREATE TRIGGER "role-has-permission_trigger_update_modified_at"
	BEFORE UPDATE ON "role-has-permission"
	FOR EACH ROW
	EXECUTE PROCEDURE "trigger_update_modified_at"();
END IF;
END;
$$

CREATE TABLE IF NOT EXISTS "user" (
	"created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	"actor" INTEGER NOT NULL
,	"username" VARCHAR(255) NOT NULL UNIQUE
,	"password" CHAR(60) NULL
,	"jwt secret" VARCHAR(255) NULL
,	"email" TEXT NULL
,	FOREIGN KEY ("actor") REFERENCES "actor" ("id")
);

DO
$$
BEGIN
IF NOT EXISTS(
	SELECT 1
	FROM "information_schema"."triggers"
	WHERE "event_object_table" = 'user'
	AND "trigger_name" = 'user_trigger_update_modified_at'
) THEN
	CREATE TRIGGER "user_trigger_update_modified_at"
	BEFORE UPDATE ON "user"
	FOR EACH ROW
	EXECUTE PROCEDURE "trigger_update_modified_at"();
END IF;
END;
$$

CREATE TABLE IF NOT EXISTS "user-has-role" (
	"created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"user" INTEGER NOT NULL
,	"role" INTEGER NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	"expiry date" TIMESTAMP NULL
,	FOREIGN KEY ("user") REFERENCES "user" ("id")
,	FOREIGN KEY ("role") REFERENCES "role" ("id")
,	UNIQUE("user", "role")
);

DO
$$
BEGIN
IF NOT EXISTS(
	SELECT 1
	FROM "information_schema"."triggers"
	WHERE "event_object_table" = 'user-has-role'
	AND "trigger_name" = 'user-has-role_trigger_update_modified_at'
) THEN
	CREATE TRIGGER "user-has-role_trigger_update_modified_at"
	BEFORE UPDATE ON "user-has-role"
	FOR EACH ROW
	EXECUTE PROCEDURE "trigger_update_modified_at"();
END IF;
END;
$$

CREATE TABLE IF NOT EXISTS "user-has-permission" (
	"created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"user" INTEGER NOT NULL
,	"permission" INTEGER NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	"expiry date" TIMESTAMP NULL
,	FOREIGN KEY ("user") REFERENCES "user" ("id")
,	FOREIGN KEY ("permission") REFERENCES "permission" ("id")
,	UNIQUE("user", "permission")
);

DO
$$
BEGIN
IF NOT EXISTS(
	SELECT 1
	FROM "information_schema"."triggers"
	WHERE "event_object_table" = 'user-has-permission'
	AND "trigger_name" = 'user-has-permission_trigger_update_modified_at'
) THEN
	CREATE TRIGGER "user-has-permission_trigger_update_modified_at"
	BEFORE UPDATE ON "user-has-permission"
	FOR EACH ROW
	EXECUTE PROCEDURE "trigger_update_modified_at"();
END IF;
END;
$$

CREATE TABLE IF NOT EXISTS "api key" (
	"created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	"key" VARCHAR(255) NOT NULL UNIQUE
,	"is of-actor" INTEGER NOT NULL
,	"name" VARCHAR(255) NULL
,	"description" TEXT NULL
,	FOREIGN KEY ("is of-actor") REFERENCES "actor" ("id")
);

DO
$$
BEGIN
IF NOT EXISTS(
	SELECT 1
	FROM "information_schema"."triggers"
	WHERE "event_object_table" = 'api key'
	AND "trigger_name" = 'api key_trigger_update_modified_at'
) THEN
	CREATE TRIGGER "api key_trigger_update_modified_at"
	BEFORE UPDATE ON "api key"
	FOR EACH ROW
	EXECUTE PROCEDURE "trigger_update_modified_at"();
END IF;
END;
$$

CREATE TABLE IF NOT EXISTS "api key-has-role" (
	"created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"api key" INTEGER NOT NULL
,	"role" INTEGER NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	FOREIGN KEY ("api key") REFERENCES "api key" ("id")
,	FOREIGN KEY ("role") REFERENCES "role" ("id")
,	UNIQUE("api key", "role")
);

DO
$$
BEGIN
IF NOT EXISTS(
	SELECT 1
	FROM "information_schema"."triggers"
	WHERE "event_object_table" = 'api key-has-role'
	AND "trigger_name" = 'api key-has-role_trigger_update_modified_at'
) THEN
	CREATE TRIGGER "api key-has-role_trigger_update_modified_at"
	BEFORE UPDATE ON "api key-has-role"
	FOR EACH ROW
	EXECUTE PROCEDURE "trigger_update_modified_at"();
END IF;
END;
$$

CREATE TABLE IF NOT EXISTS "api key-has-permission" (
	"created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"api key" INTEGER NOT NULL
,	"permission" INTEGER NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	FOREIGN KEY ("api key") REFERENCES "api key" ("id")
,	FOREIGN KEY ("permission") REFERENCES "permission" ("id")
,	UNIQUE("api key", "permission")
);

DO
$$
BEGIN
IF NOT EXISTS(
	SELECT 1
	FROM "information_schema"."triggers"
	WHERE "event_object_table" = 'api key-has-permission'
	AND "trigger_name" = 'api key-has-permission_trigger_update_modified_at'
) THEN
	CREATE TRIGGER "api key-has-permission_trigger_update_modified_at"
	BEFORE UPDATE ON "api key-has-permission"
	FOR EACH ROW
	EXECUTE PROCEDURE "trigger_update_modified_at"();
END IF;
END;
$$

CREATE TABLE IF NOT EXISTS "application type" (
	"created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	"name" VARCHAR(255) NOT NULL
,	"supports web url" INTEGER DEFAULT 0 NOT NULL
,	"supports multicontainer" INTEGER DEFAULT 0 NOT NULL
,	"supports gateway mode" INTEGER DEFAULT 0 NOT NULL
,	"needs-os version range" VARCHAR(255) NULL
,	"requires payment" INTEGER DEFAULT 0 NOT NULL
,	"is legacy" INTEGER DEFAULT 0 NOT NULL
,	"slug" VARCHAR(255) NOT NULL UNIQUE
,	"description" TEXT NULL
,	"maximum device count" INTEGER NULL
);

DO
$$
BEGIN
IF NOT EXISTS(
	SELECT 1
	FROM "information_schema"."triggers"
	WHERE "event_object_table" = 'application type'
	AND "trigger_name" = 'application type_trigger_update_modified_at'
) THEN
	CREATE TRIGGER "application type_trigger_update_modified_at"
	BEFORE UPDATE ON "application type"
	FOR EACH ROW
	EXECUTE PROCEDURE "trigger_update_modified_at"();
END IF;
END;
$$

CREATE TABLE IF NOT EXISTS "cpu architecture" (
	"created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	"slug" VARCHAR(255) NOT NULL UNIQUE
);

DO
$$
BEGIN
IF NOT EXISTS(
	SELECT 1
	FROM "information_schema"."triggers"
	WHERE "event_object_table" = 'cpu architecture'
	AND "trigger_name" = 'cpu architecture_trigger_update_modified_at'
) THEN
	CREATE TRIGGER "cpu architecture_trigger_update_modified_at"
	BEFORE UPDATE ON "cpu architecture"
	FOR EACH ROW
	EXECUTE PROCEDURE "trigger_update_modified_at"();
END IF;
END;
$$

CREATE TABLE IF NOT EXISTS "config" (
	"created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	"key" VARCHAR(255) NOT NULL
,	"value" TEXT NOT NULL
,	"scope" VARCHAR(255) NULL
,	"description" TEXT NULL
);

DO
$$
BEGIN
IF NOT EXISTS(
	SELECT 1
	FROM "information_schema"."triggers"
	WHERE "event_object_table" = 'config'
	AND "trigger_name" = 'config_trigger_update_modified_at'
) THEN
	CREATE TRIGGER "config_trigger_update_modified_at"
	BEFORE UPDATE ON "config"
	FOR EACH ROW
	EXECUTE PROCEDURE "trigger_update_modified_at"();
END IF;
END;
$$

CREATE TABLE IF NOT EXISTS "device manufacturer" (
	"created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	"slug" VARCHAR(255) NOT NULL UNIQUE
,	"name" VARCHAR(255) NOT NULL
);

DO
$$
BEGIN
IF NOT EXISTS(
	SELECT 1
	FROM "information_schema"."triggers"
	WHERE "event_object_table" = 'device manufacturer'
	AND "trigger_name" = 'device manufacturer_trigger_update_modified_at'
) THEN
	CREATE TRIGGER "device manufacturer_trigger_update_modified_at"
	BEFORE UPDATE ON "device manufacturer"
	FOR EACH ROW
	EXECUTE PROCEDURE "trigger_update_modified_at"();
END IF;
END;
$$

CREATE TABLE IF NOT EXISTS "organization" (
	"created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	"name" VARCHAR(255) NOT NULL
,	"handle" VARCHAR(255) NOT NULL UNIQUE
,	-- It is necessary that each name (Auth) of an organization, has a Length (Type) that is greater than 0.
CONSTRAINT "organization$E+cBryACQrrUVLO1vZD8cqyxwba+nOu+T7UYno7mUZ0=" CHECK (0 < LENGTH("name")
AND LENGTH("name") IS NOT NULL)
,	-- It is necessary that each handle of an organization, has a Length (Type) that is greater than 0.
CONSTRAINT "organization$/jm+9cFLOktW7UDAih9SkCWgaZxrnJBTAFjsx8Lrc7A=" CHECK (0 < LENGTH("handle")
AND LENGTH("handle") IS NOT NULL)
);

DO
$$
BEGIN
IF NOT EXISTS(
	SELECT 1
	FROM "information_schema"."triggers"
	WHERE "event_object_table" = 'organization'
	AND "trigger_name" = 'organization_trigger_update_modified_at'
) THEN
	CREATE TRIGGER "organization_trigger_update_modified_at"
	BEFORE UPDATE ON "organization"
	FOR EACH ROW
	EXECUTE PROCEDURE "trigger_update_modified_at"();
END IF;
END;
$$

CREATE TABLE IF NOT EXISTS "service instance" (
	"created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	"service type" VARCHAR(255) NOT NULL
,	"ip address" VARCHAR(255) NOT NULL
,	"last heartbeat" TIMESTAMP NOT NULL
);

DO
$$
BEGIN
IF NOT EXISTS(
	SELECT 1
	FROM "information_schema"."triggers"
	WHERE "event_object_table" = 'service instance'
	AND "trigger_name" = 'service instance_trigger_update_modified_at'
) THEN
	CREATE TRIGGER "service instance_trigger_update_modified_at"
	BEFORE UPDATE ON "service instance"
	FOR EACH ROW
	EXECUTE PROCEDURE "trigger_update_modified_at"();
END IF;
END;
$$

CREATE TABLE IF NOT EXISTS "release" (
	"created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	"belongs to-application" INTEGER NOT NULL
,	"commit" VARCHAR(255) NOT NULL
,	"composition" TEXT NOT NULL
,	"status" VARCHAR(255) NOT NULL
,	"source" VARCHAR(255) NOT NULL
,	"build log" TEXT NULL
,	"is invalidated" INTEGER DEFAULT 0 NOT NULL
,	"start timestamp" TIMESTAMP NOT NULL
,	"end timestamp" TIMESTAMP NULL
,	"update timestamp" TIMESTAMP NOT NULL
,	"release version" VARCHAR(255) NULL
,	"contract" TEXT NULL
,	"is passing tests" INTEGER DEFAULT 0 NOT NULL
,	"release type" VARCHAR(255) NOT NULL CHECK ("release type" IN ('final', 'draft'))
);

DO
$$
BEGIN
IF NOT EXISTS(
	SELECT 1
	FROM "information_schema"."triggers"
	WHERE "event_object_table" = 'release'
	AND "trigger_name" = 'release_trigger_update_modified_at'
) THEN
	CREATE TRIGGER "release_trigger_update_modified_at"
	BEFORE UPDATE ON "release"
	FOR EACH ROW
	EXECUTE PROCEDURE "trigger_update_modified_at"();
END IF;
END;
$$

CREATE TABLE IF NOT EXISTS "release tag" (
	"created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"release" INTEGER NOT NULL
,	"tag key" VARCHAR(255) NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	"value" TEXT NOT NULL
,	FOREIGN KEY ("release") REFERENCES "release" ("id")
,	UNIQUE("release", "tag key")
,	-- It is necessary that each release tag has a tag key that has a Length (Type) that is greater than 0.
CONSTRAINT "release tag$vGZu47lKJepQVH+hgSZNuUPdet2cG96akz3Yc8hta3A=" CHECK (0 < LENGTH("tag key")
AND LENGTH("tag key") IS NOT NULL
AND "tag key" = "tag key"
AND "tag key" IS NOT NULL)
);

DO
$$
BEGIN
IF NOT EXISTS(
	SELECT 1
	FROM "information_schema"."triggers"
	WHERE "event_object_table" = 'release tag'
	AND "trigger_name" = 'release tag_trigger_update_modified_at'
) THEN
	CREATE TRIGGER "release tag_trigger_update_modified_at"
	BEFORE UPDATE ON "release tag"
	FOR EACH ROW
	EXECUTE PROCEDURE "trigger_update_modified_at"();
END IF;
END;
$$

CREATE TABLE IF NOT EXISTS "organization membership" (
	"created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"user" INTEGER NOT NULL
,	"is member of-organization" INTEGER NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	FOREIGN KEY ("user") REFERENCES "user" ("id")
,	FOREIGN KEY ("is member of-organization") REFERENCES "organization" ("id")
,	UNIQUE("user", "is member of-organization")
);

DO
$$
BEGIN
IF NOT EXISTS(
	SELECT 1
	FROM "information_schema"."triggers"
	WHERE "event_object_table" = 'organization membership'
	AND "trigger_name" = 'organization membership_trigger_update_modified_at'
) THEN
	CREATE TRIGGER "organization membership_trigger_update_modified_at"
	BEFORE UPDATE ON "organization membership"
	FOR EACH ROW
	EXECUTE PROCEDURE "trigger_update_modified_at"();
END IF;
END;
$$

CREATE TABLE IF NOT EXISTS "user-has-public key" (
	"created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"user" INTEGER NOT NULL
,	"public key" TEXT NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	"title" VARCHAR(255) NOT NULL
,	FOREIGN KEY ("user") REFERENCES "user" ("id")
,	UNIQUE("user", "public key")
);

DO
$$
BEGIN
IF NOT EXISTS(
	SELECT 1
	FROM "information_schema"."triggers"
	WHERE "event_object_table" = 'user-has-public key'
	AND "trigger_name" = 'user-has-public key_trigger_update_modified_at'
) THEN
	CREATE TRIGGER "user-has-public key_trigger_update_modified_at"
	BEFORE UPDATE ON "user-has-public key"
	FOR EACH ROW
	EXECUTE PROCEDURE "trigger_update_modified_at"();
END IF;
END;
$$

CREATE TABLE IF NOT EXISTS "device family" (
	"created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	"slug" VARCHAR(255) NOT NULL UNIQUE
,	"name" VARCHAR(255) NOT NULL
,	"is manufactured by-device manufacturer" INTEGER NULL
,	FOREIGN KEY ("is manufactured by-device manufacturer") REFERENCES "device manufacturer" ("id")
);

DO
$$
BEGIN
IF NOT EXISTS(
	SELECT 1
	FROM "information_schema"."triggers"
	WHERE "event_object_table" = 'device family'
	AND "trigger_name" = 'device family_trigger_update_modified_at'
) THEN
	CREATE TRIGGER "device family_trigger_update_modified_at"
	BEFORE UPDATE ON "device family"
	FOR EACH ROW
	EXECUTE PROCEDURE "trigger_update_modified_at"();
END IF;
END;
$$

CREATE TABLE IF NOT EXISTS "device type" (
	"created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	"slug" VARCHAR(255) NOT NULL UNIQUE
,	"name" VARCHAR(255) NOT NULL
,	"is of-cpu architecture" INTEGER NOT NULL
,	"logo" TEXT NULL
,	"contract" TEXT NULL
,	"belongs to-device family" INTEGER NULL
,	FOREIGN KEY ("is of-cpu architecture") REFERENCES "cpu architecture" ("id")
,	FOREIGN KEY ("belongs to-device family") REFERENCES "device family" ("id")
);

DO
$$
BEGIN
IF NOT EXISTS(
	SELECT 1
	FROM "information_schema"."triggers"
	WHERE "event_object_table" = 'device type'
	AND "trigger_name" = 'device type_trigger_update_modified_at'
) THEN
	CREATE TRIGGER "device type_trigger_update_modified_at"
	BEFORE UPDATE ON "device type"
	FOR EACH ROW
	EXECUTE PROCEDURE "trigger_update_modified_at"();
END IF;
END;
$$

CREATE TABLE IF NOT EXISTS "application" (
	"created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	"actor" INTEGER NOT NULL
,	"should track latest release" INTEGER DEFAULT 0 NOT NULL
,	"organization" INTEGER NOT NULL
,	"app name" TEXT NOT NULL
,	"slug" VARCHAR(255) NOT NULL UNIQUE
,	"is for-device type" INTEGER NOT NULL
,	"should be running-release" INTEGER NULL
,	"depends on-application" INTEGER NULL
,	"application type" INTEGER NOT NULL
,	"is host" INTEGER DEFAULT 0 NOT NULL
,	"is archived" INTEGER DEFAULT 0 NOT NULL
,	"uuid" TEXT NOT NULL UNIQUE
,	"is public" INTEGER DEFAULT 0 NOT NULL
,	FOREIGN KEY ("actor") REFERENCES "actor" ("id")
,	FOREIGN KEY ("organization") REFERENCES "organization" ("id")
,	FOREIGN KEY ("is for-device type") REFERENCES "device type" ("id")
,	FOREIGN KEY ("should be running-release") REFERENCES "release" ("id")
,	FOREIGN KEY ("depends on-application") REFERENCES "application" ("id")
,	FOREIGN KEY ("application type") REFERENCES "application type" ("id")
,	-- It is necessary that each application has an app name that has a Length (Type) that is greater than or equal to 4 and is less than or equal to 100.
CONSTRAINT "application$Rlu1vWu2xL/ssYhMPT7xj1zIn00+4AkgpcvOQN9Lr+s=" CHECK (4 <= LENGTH("app name")
AND LENGTH("app name") <= 100
AND LENGTH("app name") IS NOT NULL
AND "app name" IS NOT NULL)
,	-- It is necessary that each application has a uuid that has a Length (Type) that is equal to 32.
CONSTRAINT "application$GZ8FNlwwxFjgC1YvG6LoHCW/ECfWTpQLmNYKUJQoSXI=" CHECK (LENGTH("uuid") = 32
AND LENGTH("uuid") IS NOT NULL
AND "uuid" IS NOT NULL)
);

DO
$$
BEGIN
IF NOT EXISTS(
	SELECT 1
	FROM "information_schema"."triggers"
	WHERE "event_object_table" = 'application'
	AND "trigger_name" = 'application_trigger_update_modified_at'
) THEN
	CREATE TRIGGER "application_trigger_update_modified_at"
	BEFORE UPDATE ON "application"
	FOR EACH ROW
	EXECUTE PROCEDURE "trigger_update_modified_at"();
END IF;
END;
$$

CREATE TABLE IF NOT EXISTS "application environment variable" (
	"created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"application" INTEGER NOT NULL
,	"name" VARCHAR(255) NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	"value" TEXT NOT NULL
,	FOREIGN KEY ("application") REFERENCES "application" ("id")
,	UNIQUE("application", "name")
);

DO
$$
BEGIN
IF NOT EXISTS(
	SELECT 1
	FROM "information_schema"."triggers"
	WHERE "event_object_table" = 'application environment variable'
	AND "trigger_name" = 'application environment variable_trigger_update_modified_at'
) THEN
	CREATE TRIGGER "application environment variable_trigger_update_modified_at"
	BEFORE UPDATE ON "application environment variable"
	FOR EACH ROW
	EXECUTE PROCEDURE "trigger_update_modified_at"();
END IF;
END;
$$

CREATE TABLE IF NOT EXISTS "application config variable" (
	"created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"application" INTEGER NOT NULL
,	"name" VARCHAR(255) NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	"value" TEXT NOT NULL
,	FOREIGN KEY ("application") REFERENCES "application" ("id")
,	UNIQUE("application", "name")
);

DO
$$
BEGIN
IF NOT EXISTS(
	SELECT 1
	FROM "information_schema"."triggers"
	WHERE "event_object_table" = 'application config variable'
	AND "trigger_name" = 'application config variable_trigger_update_modified_at'
) THEN
	CREATE TRIGGER "application config variable_trigger_update_modified_at"
	BEFORE UPDATE ON "application config variable"
	FOR EACH ROW
	EXECUTE PROCEDURE "trigger_update_modified_at"();
END IF;
END;
$$

CREATE TABLE IF NOT EXISTS "service" (
	"created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"application" INTEGER NOT NULL
,	"service name" VARCHAR(255) NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	FOREIGN KEY ("application") REFERENCES "application" ("id")
,	UNIQUE("application", "service name")
);

DO
$$
BEGIN
IF NOT EXISTS(
	SELECT 1
	FROM "information_schema"."triggers"
	WHERE "event_object_table" = 'service'
	AND "trigger_name" = 'service_trigger_update_modified_at'
) THEN
	CREATE TRIGGER "service_trigger_update_modified_at"
	BEFORE UPDATE ON "service"
	FOR EACH ROW
	EXECUTE PROCEDURE "trigger_update_modified_at"();
END IF;
END;
$$

CREATE TABLE IF NOT EXISTS "service label" (
	"created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"service" INTEGER NOT NULL
,	"label name" VARCHAR(255) NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	"value" TEXT NOT NULL
,	FOREIGN KEY ("service") REFERENCES "service" ("id")
,	UNIQUE("service", "label name")
);

DO
$$
BEGIN
IF NOT EXISTS(
	SELECT 1
	FROM "information_schema"."triggers"
	WHERE "event_object_table" = 'service label'
	AND "trigger_name" = 'service label_trigger_update_modified_at'
) THEN
	CREATE TRIGGER "service label_trigger_update_modified_at"
	BEFORE UPDATE ON "service label"
	FOR EACH ROW
	EXECUTE PROCEDURE "trigger_update_modified_at"();
END IF;
END;
$$

CREATE TABLE IF NOT EXISTS "service environment variable" (
	"created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"service" INTEGER NOT NULL
,	"name" VARCHAR(255) NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	"value" TEXT NOT NULL
,	FOREIGN KEY ("service") REFERENCES "service" ("id")
,	UNIQUE("service", "name")
);

DO
$$
BEGIN
IF NOT EXISTS(
	SELECT 1
	FROM "information_schema"."triggers"
	WHERE "event_object_table" = 'service environment variable'
	AND "trigger_name" = 'service environment variable_trigger_update_modified_at'
) THEN
	CREATE TRIGGER "service environment variable_trigger_update_modified_at"
	BEFORE UPDATE ON "service environment variable"
	FOR EACH ROW
	EXECUTE PROCEDURE "trigger_update_modified_at"();
END IF;
END;
$$

CREATE TABLE IF NOT EXISTS "application tag" (
	"created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"application" INTEGER NOT NULL
,	"tag key" VARCHAR(255) NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	"value" TEXT NOT NULL
,	FOREIGN KEY ("application") REFERENCES "application" ("id")
,	UNIQUE("application", "tag key")
,	-- It is necessary that each application tag has a tag key that has a Length (Type) that is greater than 0.
CONSTRAINT "application tag$zPAVMu9ZY2npomham40YGgXx5N6Hau03dIo6x9gf6/E=" CHECK (0 < LENGTH("tag key")
AND LENGTH("tag key") IS NOT NULL
AND "tag key" = "tag key"
AND "tag key" IS NOT NULL)
);

DO
$$
BEGIN
IF NOT EXISTS(
	SELECT 1
	FROM "information_schema"."triggers"
	WHERE "event_object_table" = 'application tag'
	AND "trigger_name" = 'application tag_trigger_update_modified_at'
) THEN
	CREATE TRIGGER "application tag_trigger_update_modified_at"
	BEFORE UPDATE ON "application tag"
	FOR EACH ROW
	EXECUTE PROCEDURE "trigger_update_modified_at"();
END IF;
END;
$$

CREATE TABLE IF NOT EXISTS "device" (
	"created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	"actor" INTEGER NOT NULL
,	"api heartbeat state" VARCHAR(255) NOT NULL CHECK ("api heartbeat state" IN ('online', 'offline', 'timeout', 'unknown'))
,	"uuid" TEXT NOT NULL UNIQUE
,	"local id" VARCHAR(255) NULL
,	"device name" VARCHAR(255) NULL
,	"note" TEXT NULL
,	"is of-device type" INTEGER NOT NULL
,	"belongs to-application" INTEGER NULL
,	"is online" INTEGER DEFAULT 0 NOT NULL
,	"last connectivity event" TIMESTAMP NULL
,	"is connected to vpn" INTEGER DEFAULT 0 NOT NULL
,	"last vpn event" TIMESTAMP NULL
,	"is locked until-date" TIMESTAMP NULL
,	"logs channel" VARCHAR(255) NULL
,	"public address" VARCHAR(255) NULL
,	"vpn address" VARCHAR(255) NULL
,	"ip address" VARCHAR(255) NULL
,	"mac address" VARCHAR(255) NULL
,	"memory usage" INTEGER NULL
,	"memory total" INTEGER NULL
,	"storage block device" VARCHAR(255) NULL
,	"storage usage" INTEGER NULL
,	"storage total" INTEGER NULL
,	"cpu usage" INTEGER NULL
,	"cpu temp" INTEGER NULL
,	"is undervolted" INTEGER DEFAULT 0 NOT NULL
,	"cpu id" VARCHAR(255) NULL
,	"is running-release" INTEGER NULL
,	"download progress" INTEGER NULL
,	"status" VARCHAR(255) NULL
,	"os version" VARCHAR(255) NULL
,	"os variant" VARCHAR(255) NULL
,	"supervisor version" VARCHAR(255) NULL
,	"provisioning progress" INTEGER NULL
,	"provisioning state" VARCHAR(255) NULL
,	"api port" INTEGER NULL
,	"api secret" VARCHAR(255) NULL
,	"is managed by-service instance" INTEGER NULL
,	"should be running-release" INTEGER NULL
,	"should be operated by-release" INTEGER NULL
,	"is managed by-device" INTEGER NULL
,	FOREIGN KEY ("actor") REFERENCES "actor" ("id")
,	FOREIGN KEY ("is of-device type") REFERENCES "device type" ("id")
,	FOREIGN KEY ("belongs to-application") REFERENCES "application" ("id")
,	FOREIGN KEY ("is running-release") REFERENCES "release" ("id")
,	FOREIGN KEY ("is managed by-service instance") REFERENCES "service instance" ("id")
,	FOREIGN KEY ("should be running-release") REFERENCES "release" ("id")
,	FOREIGN KEY ("should be operated by-release") REFERENCES "release" ("id")
,	FOREIGN KEY ("is managed by-device") REFERENCES "device" ("id")
);

DO
$$
BEGIN
IF NOT EXISTS(
	SELECT 1
	FROM "information_schema"."triggers"
	WHERE "event_object_table" = 'device'
	AND "trigger_name" = 'device_trigger_update_modified_at'
) THEN
	CREATE TRIGGER "device_trigger_update_modified_at"
	BEFORE UPDATE ON "device"
	FOR EACH ROW
	EXECUTE PROCEDURE "trigger_update_modified_at"();
END IF;
END;
$$

CREATE TABLE IF NOT EXISTS "device environment variable" (
	"created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"device" INTEGER NOT NULL
,	"name" VARCHAR(255) NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	"value" TEXT NOT NULL
,	FOREIGN KEY ("device") REFERENCES "device" ("id")
,	UNIQUE("device", "name")
);

DO
$$
BEGIN
IF NOT EXISTS(
	SELECT 1
	FROM "information_schema"."triggers"
	WHERE "event_object_table" = 'device environment variable'
	AND "trigger_name" = 'device environment variable_trigger_update_modified_at'
) THEN
	CREATE TRIGGER "device environment variable_trigger_update_modified_at"
	BEFORE UPDATE ON "device environment variable"
	FOR EACH ROW
	EXECUTE PROCEDURE "trigger_update_modified_at"();
END IF;
END;
$$

CREATE TABLE IF NOT EXISTS "device config variable" (
	"created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"device" INTEGER NOT NULL
,	"name" VARCHAR(255) NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	"value" TEXT NOT NULL
,	FOREIGN KEY ("device") REFERENCES "device" ("id")
,	UNIQUE("device", "name")
);

DO
$$
BEGIN
IF NOT EXISTS(
	SELECT 1
	FROM "information_schema"."triggers"
	WHERE "event_object_table" = 'device config variable'
	AND "trigger_name" = 'device config variable_trigger_update_modified_at'
) THEN
	CREATE TRIGGER "device config variable_trigger_update_modified_at"
	BEFORE UPDATE ON "device config variable"
	FOR EACH ROW
	EXECUTE PROCEDURE "trigger_update_modified_at"();
END IF;
END;
$$

CREATE TABLE IF NOT EXISTS "service install" (
	"created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"device" INTEGER NOT NULL
,	"installs-service" INTEGER NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	FOREIGN KEY ("device") REFERENCES "device" ("id")
,	FOREIGN KEY ("installs-service") REFERENCES "service" ("id")
,	UNIQUE("device", "installs-service")
);

DO
$$
BEGIN
IF NOT EXISTS(
	SELECT 1
	FROM "information_schema"."triggers"
	WHERE "event_object_table" = 'service install'
	AND "trigger_name" = 'service install_trigger_update_modified_at'
) THEN
	CREATE TRIGGER "service install_trigger_update_modified_at"
	BEFORE UPDATE ON "service install"
	FOR EACH ROW
	EXECUTE PROCEDURE "trigger_update_modified_at"();
END IF;
END;
$$

CREATE TABLE IF NOT EXISTS "device service environment variable" (
	"created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"service install" INTEGER NOT NULL
,	"name" VARCHAR(255) NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	"value" TEXT NOT NULL
,	FOREIGN KEY ("service install") REFERENCES "service install" ("id")
,	UNIQUE("service install", "name")
);

DO
$$
BEGIN
IF NOT EXISTS(
	SELECT 1
	FROM "information_schema"."triggers"
	WHERE "event_object_table" = 'device service environment variable'
	AND "trigger_name" = 'device service environment variable_trigger_update_modified_at'
) THEN
	CREATE TRIGGER "device service environment variable_trigger_update_modified_at"
	BEFORE UPDATE ON "device service environment variable"
	FOR EACH ROW
	EXECUTE PROCEDURE "trigger_update_modified_at"();
END IF;
END;
$$

CREATE TABLE IF NOT EXISTS "device tag" (
	"created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"device" INTEGER NOT NULL
,	"tag key" VARCHAR(255) NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	"value" TEXT NOT NULL
,	FOREIGN KEY ("device") REFERENCES "device" ("id")
,	UNIQUE("device", "tag key")
,	-- It is necessary that each device tag has a tag key that has a Length (Type) that is greater than 0.
CONSTRAINT "device tag$30aEY0OcDs3I/zbRIyNPL9K/I7WY+4PabIF1sxOvXKg=" CHECK (0 < LENGTH("tag key")
AND LENGTH("tag key") IS NOT NULL
AND "tag key" = "tag key"
AND "tag key" IS NOT NULL)
);

DO
$$
BEGIN
IF NOT EXISTS(
	SELECT 1
	FROM "information_schema"."triggers"
	WHERE "event_object_table" = 'device tag'
	AND "trigger_name" = 'device tag_trigger_update_modified_at'
) THEN
	CREATE TRIGGER "device tag_trigger_update_modified_at"
	BEFORE UPDATE ON "device tag"
	FOR EACH ROW
	EXECUTE PROCEDURE "trigger_update_modified_at"();
END IF;
END;
$$

CREATE TABLE IF NOT EXISTS "image" (
	"created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	"start timestamp" TIMESTAMP NOT NULL
,	"end timestamp" TIMESTAMP NULL
,	"dockerfile" TEXT NULL
,	"is a build of-service" INTEGER NOT NULL
,	"image size" BIGINT NULL
,	"is stored at-image location" VARCHAR(255) NOT NULL UNIQUE
,	"project type" VARCHAR(255) NULL
,	"error message" TEXT NULL
,	"build log" TEXT NULL
,	"push timestamp" TIMESTAMP NULL
,	"status" VARCHAR(255) NOT NULL
,	"content hash" VARCHAR(255) NULL
,	"contract" TEXT NULL
,	FOREIGN KEY ("is a build of-service") REFERENCES "service" ("id")
,	-- It is necessary that each image that has a status that is equal to "success", has a push timestamp.
CONSTRAINT "image$EsnlFqzUfM0jeomVNVuB+GgghnPSgJlMCa0zMBA6cV8=" CHECK (NOT (
	"status" = 'success'
	AND "status" IS NOT NULL
	AND "push timestamp" IS NULL
))
);

DO
$$
BEGIN
IF NOT EXISTS(
	SELECT 1
	FROM "information_schema"."triggers"
	WHERE "event_object_table" = 'image'
	AND "trigger_name" = 'image_trigger_update_modified_at'
) THEN
	CREATE TRIGGER "image_trigger_update_modified_at"
	BEFORE UPDATE ON "image"
	FOR EACH ROW
	EXECUTE PROCEDURE "trigger_update_modified_at"();
END IF;
END;
$$

CREATE TABLE IF NOT EXISTS "image install" (
	"created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"device" INTEGER NOT NULL
,	"installs-image" INTEGER NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	"install date" TIMESTAMP NOT NULL
,	"download progress" INTEGER NULL
,	"status" VARCHAR(255) NOT NULL
,	"is provided by-release" INTEGER NOT NULL
,	FOREIGN KEY ("device") REFERENCES "device" ("id")
,	FOREIGN KEY ("installs-image") REFERENCES "image" ("id")
,	FOREIGN KEY ("is provided by-release") REFERENCES "release" ("id")
,	UNIQUE("device", "installs-image")
);

DO
$$
BEGIN
IF NOT EXISTS(
	SELECT 1
	FROM "information_schema"."triggers"
	WHERE "event_object_table" = 'image install'
	AND "trigger_name" = 'image install_trigger_update_modified_at'
) THEN
	CREATE TRIGGER "image install_trigger_update_modified_at"
	BEFORE UPDATE ON "image install"
	FOR EACH ROW
	EXECUTE PROCEDURE "trigger_update_modified_at"();
END IF;
END;
$$

CREATE TABLE IF NOT EXISTS "gateway download" (
	"created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"image" INTEGER NOT NULL
,	"is downloaded by-device" INTEGER NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	"status" VARCHAR(255) NOT NULL
,	"download progress" INTEGER NULL
,	FOREIGN KEY ("image") REFERENCES "image" ("id")
,	FOREIGN KEY ("is downloaded by-device") REFERENCES "device" ("id")
,	UNIQUE("image", "is downloaded by-device")
);

DO
$$
BEGIN
IF NOT EXISTS(
	SELECT 1
	FROM "information_schema"."triggers"
	WHERE "event_object_table" = 'gateway download'
	AND "trigger_name" = 'gateway download_trigger_update_modified_at'
) THEN
	CREATE TRIGGER "gateway download_trigger_update_modified_at"
	BEFORE UPDATE ON "gateway download"
	FOR EACH ROW
	EXECUTE PROCEDURE "trigger_update_modified_at"();
END IF;
END;
$$

CREATE TABLE IF NOT EXISTS "image-is part of-release" (
	"created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"image" INTEGER NOT NULL
,	"is part of-release" INTEGER NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	FOREIGN KEY ("image") REFERENCES "image" ("id")
,	FOREIGN KEY ("is part of-release") REFERENCES "release" ("id")
,	UNIQUE("image", "is part of-release")
);

DO
$$
BEGIN
IF NOT EXISTS(
	SELECT 1
	FROM "information_schema"."triggers"
	WHERE "event_object_table" = 'image-is part of-release'
	AND "trigger_name" = 'image-is part of-release_trigger_update_modified_at'
) THEN
	CREATE TRIGGER "image-is part of-release_trigger_update_modified_at"
	BEFORE UPDATE ON "image-is part of-release"
	FOR EACH ROW
	EXECUTE PROCEDURE "trigger_update_modified_at"();
END IF;
END;
$$

CREATE TABLE IF NOT EXISTS "image label" (
	"created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"release image" INTEGER NOT NULL
,	"label name" VARCHAR(255) NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	"value" TEXT NOT NULL
,	FOREIGN KEY ("release image") REFERENCES "image-is part of-release" ("id")
,	UNIQUE("release image", "label name")
);

DO
$$
BEGIN
IF NOT EXISTS(
	SELECT 1
	FROM "information_schema"."triggers"
	WHERE "event_object_table" = 'image label'
	AND "trigger_name" = 'image label_trigger_update_modified_at'
) THEN
	CREATE TRIGGER "image label_trigger_update_modified_at"
	BEFORE UPDATE ON "image label"
	FOR EACH ROW
	EXECUTE PROCEDURE "trigger_update_modified_at"();
END IF;
END;
$$

CREATE TABLE IF NOT EXISTS "image environment variable" (
	"created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"release image" INTEGER NOT NULL
,	"name" VARCHAR(255) NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	"value" TEXT NOT NULL
,	FOREIGN KEY ("release image") REFERENCES "image-is part of-release" ("id")
,	UNIQUE("release image", "name")
);

DO
$$
BEGIN
IF NOT EXISTS(
	SELECT 1
	FROM "information_schema"."triggers"
	WHERE "event_object_table" = 'image environment variable'
	AND "trigger_name" = 'image environment variable_trigger_update_modified_at'
) THEN
	CREATE TRIGGER "image environment variable_trigger_update_modified_at"
	BEFORE UPDATE ON "image environment variable"
	FOR EACH ROW
	EXECUTE PROCEDURE "trigger_update_modified_at"();
END IF;
END;
$$

DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		JOIN information_schema.key_column_usage kcu USING (constraint_catalog, constraint_schema, constraint_name)
		JOIN information_schema.constraint_column_usage ccu USING (constraint_catalog, constraint_schema, constraint_name)
		WHERE constraint_type = 'FOREIGN KEY'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'release'
			AND kcu.column_name = 'belongs to-application'
			AND ccu.table_schema = CURRENT_SCHEMA()
			AND ccu.table_name = 'application'
			AND ccu.column_name = 'id'
	) THEN
		ALTER TABLE "release"
		ADD CONSTRAINT "release_belongs to-application_fkey"
		FOREIGN KEY ("belongs to-application") REFERENCES "application" ("id");
	END IF;
END;
$$;

--
-- Rule validation queries
--

-- It is necessary that each device1 that is managed by a device2, belongs to an application1 that depends on an application2 that owns the device2.
SELECT NOT EXISTS (
	SELECT 1
	FROM "device" AS "device.0",
		"device" AS "device.1"
	WHERE "device.0"."is managed by-device" = "device.1"."id"
	AND NOT EXISTS (
		SELECT 1
		FROM "application" AS "application.2",
			"application" AS "application.3"
		WHERE "device.1"."belongs to-application" = "application.3"."id"
		AND "application.2"."depends on-application" = "application.3"."id"
		AND "device.0"."belongs to-application" = "application.2"."id"
	)
) AS "result";

-- It is necessary that each release that has a release version1 and has a status that is equal to "success" and is not invalidated, belongs to an application that owns exactly one release that has a release version2 that is equal to the release version1 and has a status that is equal to "success" and is not invalidated.
SELECT NOT EXISTS (
	SELECT 1
	FROM "release" AS "release.0"
	WHERE "release.0"."release version" IS NOT NULL
	AND "release.0"."status" = $1
	AND "release.0"."status" IS NOT NULL
	AND "release.0"."is invalidated" = 0
	AND NOT EXISTS (
		SELECT 1
		FROM "application" AS "application.3"
		WHERE (
			SELECT COUNT(*)
			FROM "release" AS "release.4"
			WHERE "release.4"."release version" = "release.0"."release version"
			AND "release.4"."release version" IS NOT NULL
			AND "release.4"."status" = $2
			AND "release.4"."status" IS NOT NULL
			AND "release.4"."is invalidated" = 0
			AND "release.4"."belongs to-application" = "application.3"."id"
		) = 1
		AND "release.0"."belongs to-application" = "application.3"."id"
	)
) AS "result";

-- It is necessary that each application that owns a release1 that has a status that is equal to "success" and has a commit1, owns at most one release2 that has a status that is equal to "success" and has a commit2 that is equal to the commit1.
SELECT NOT EXISTS (
	SELECT 1
	FROM "application" AS "application.0",
		"release" AS "release.1"
	WHERE "release.1"."status" = $1
	AND "release.1"."status" IS NOT NULL
	AND "release.1"."commit" IS NOT NULL
	AND "release.1"."belongs to-application" = "application.0"."id"
	AND (
		SELECT COUNT(*)
		FROM "release" AS "release.4"
		WHERE "release.4"."status" = $2
		AND "release.4"."status" IS NOT NULL
		AND "release.4"."commit" = "release.1"."commit"
		AND "release.4"."commit" IS NOT NULL
		AND "release.4"."belongs to-application" = "application.0"."id"
	) >= 2
) AS "result";

-- It is necessary that each release that should be running on a device, has a status that is equal to "success" and belongs to an application1 that the device belongs to.
SELECT NOT EXISTS (
	SELECT 1
	FROM "release" AS "release.0",
		"device" AS "device.1"
	WHERE "device.1"."should be running-release" = "release.0"."id"
	AND NOT (
		"release.0"."status" = $1
		AND "release.0"."status" IS NOT NULL
		AND EXISTS (
			SELECT 1
			FROM "application" AS "application.3"
			WHERE "device.1"."belongs to-application" = "application.3"."id"
			AND "release.0"."belongs to-application" = "application.3"."id"
		)
	)
) AS "result";

-- It is necessary that each release that should be running on an application, has a status that is equal to "success" and belongs to the application.
SELECT NOT EXISTS (
	SELECT 1
	FROM "release" AS "release.0",
		"application" AS "application.1"
	WHERE "application.1"."should be running-release" = "release.0"."id"
	AND NOT (
		"release.0"."status" = $1
		AND "release.0"."status" IS NOT NULL
		AND "release.0"."belongs to-application" = "application.1"."id"
	)
) AS "result";

-- It is necessary that each release that contains at least 2 images, belongs to an application that has an application type that supports multicontainer.
SELECT NOT EXISTS (
	SELECT 1
	FROM "release" AS "release.0"
	WHERE (
		SELECT COUNT(*)
		FROM "image-is part of-release" AS "image.1-is part of-release.0"
		WHERE "image.1-is part of-release.0"."is part of-release" = "release.0"."id"
	) >= 2
	AND NOT EXISTS (
		SELECT 1
		FROM "application" AS "application.2",
			"application type" AS "application type.3"
		WHERE "application type.3"."supports multicontainer" = 1
		AND "application.2"."application type" = "application type.3"."id"
		AND "release.0"."belongs to-application" = "application.2"."id"
	)
) AS "result";

-- It is necessary that each release that should operate a device, has a status that is equal to "success".
SELECT NOT EXISTS (
	SELECT 1
	FROM "release" AS "release.0",
		"device" AS "device.1"
	WHERE "device.1"."should be operated by-release" = "release.0"."id"
	AND NOT (
		"release.0"."status" = $1
		AND "release.0"."status" IS NOT NULL
	)
) AS "result";

-- It is necessary that each release that should operate a device, belongs to an application that is host and is for a device type that describes the device.
SELECT NOT EXISTS (
	SELECT 1
	FROM "release" AS "release.0",
		"device" AS "device.1"
	WHERE "device.1"."should be operated by-release" = "release.0"."id"
	AND NOT EXISTS (
		SELECT 1
		FROM "application" AS "application.2"
		WHERE "application.2"."is host" = 1
		AND EXISTS (
			SELECT 1
			FROM "device type" AS "device type.3"
			WHERE "device.1"."is of-device type" = "device type.3"."id"
			AND "application.2"."is for-device type" = "device type.3"."id"
		)
		AND "release.0"."belongs to-application" = "application.2"."id"
	)
) AS "result";

-- It is necessary that each device that should be operated by a release, should be operated by a release that is not invalidated or has a release tag that has a tag key that equals "version" and a value that is contained in an os version of the device.
SELECT NOT EXISTS (
	SELECT 1
	FROM "device" AS "device.0",
		"release" AS "release.1"
	WHERE "device.0"."should be operated by-release" = "release.1"."id"
	AND NOT EXISTS (
		SELECT 1
		FROM "release" AS "release.2"
		WHERE ("release.2"."is invalidated" = 0
		OR EXISTS (
			SELECT 1
			FROM "release tag" AS "release tag.3"
			WHERE $1 = "release tag.3"."tag key"
			AND EXISTS (
				SELECT 1
				FROM "value" AS "value.5"
				WHERE "device.0"."os version" LIKE ('%' || REPLACE(REPLACE(REPLACE("Text.5"."value", '\', '\\'), '_', '\_'), '%', '\%') || '%')
				AND "device.0"."os version" IS NOT NULL
				AND "Text.5"."value" = "release tag.3"."tag key"
			)
			AND "release tag.3"."tag key" IS NOT NULL
			AND "release tag.3"."release" = "release.2"."id"
		))
		AND "device.0"."should be operated by-release" = "release.2"."id"
	)
) AS "result";
