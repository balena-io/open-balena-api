CREATE TABLE IF NOT EXISTS "release asset" (
	"created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"release" INTEGER NOT NULL
,	"asset key" VARCHAR(255) NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	"asset" JSONB NOT NULL
,	FOREIGN KEY ("release") REFERENCES "release" ("id")
,	UNIQUE("release", "asset key")
,	-- It is necessary that each release asset has an asset key that has a Length (Type) that is greater than 0.
CONSTRAINT "release asset$p9L6VYTv4TOtRNnzupzjcGioRwtUZeiq0c2vYbePKko=" CHECK (0 < LENGTH("asset key")
AND LENGTH("asset key") IS NOT NULL
AND "asset key" = "asset key"
AND "asset key" IS NOT NULL)
);

DO
$$
BEGIN
IF NOT EXISTS(
	SELECT 1
	FROM "information_schema"."triggers"
	WHERE "event_object_table" = 'release asset'
	AND "trigger_name" = 'release asset_trigger_update_modified_at'
) THEN
	CREATE TRIGGER "release asset_trigger_update_modified_at"
	BEFORE UPDATE ON "release asset"
	FOR EACH ROW
	EXECUTE PROCEDURE "trigger_update_modified_at"();
END IF;
END;
$$
