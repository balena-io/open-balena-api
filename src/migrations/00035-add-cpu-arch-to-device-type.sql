CREATE TABLE IF NOT EXISTS "cpu architecture" (
    "created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "modified at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "id" SERIAL NOT NULL PRIMARY KEY,
    "slug" VARCHAR(255) NOT NULL UNIQUE
);

INSERT INTO "cpu architecture" ("slug") VALUES ('amd64') ON CONFLICT DO NOTHING;

ALTER TABLE "device type"
ADD COLUMN IF NOT EXISTS "is of-cpu architecture" INTEGER NULL,
ADD CONSTRAINT "device type_is of-cpu architecture_fkey" FOREIGN KEY ("is of-cpu architecture") REFERENCES "cpu architecture" ("id");

UPDATE "device type" SET "is of-cpu architecture" = (SELECT "id" FROM "cpu architecture" LIMIT 1) WHERE "is of-cpu architecture" IS NULL;

ALTER TABLE "device type"
ALTER COLUMN "is of-cpu architecture" SET NOT NULL;
