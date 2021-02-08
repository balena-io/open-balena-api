CREATE TABLE IF NOT EXISTS "device manufacturer" (
    "created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "modified at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "id" SERIAL NOT NULL PRIMARY KEY,
    "slug" VARCHAR(255) NOT NULL UNIQUE,
    "name" VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS "device family" (
    "created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "modified at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "id" SERIAL NOT NULL PRIMARY KEY,
    "slug" VARCHAR(255) NOT NULL UNIQUE,
    "name" VARCHAR(255) NOT NULL,
    FOREIGN KEY ("is manufactured by-device_manufacturer") REFERENCES "device manufacturer" ("id")
);

ALTER TABLE "device type" 
ADD COLUMN IF NOT EXISTS "belongs to-device family" INTEGER NULL,
ADD CONSTRAINT "device type_belongs to-device family_fkey" FOREIGN KEY ("belongs to-device family") REFERENCES "device family" ("id");