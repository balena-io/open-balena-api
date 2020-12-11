--TODO-DEVICE-ENV: test this

CREATE TABLE IF NOT EXISTS "device application environment variable" (
	"created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"device application" INTEGER NOT NULL
,	"name" VARCHAR(255) NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	"value" TEXT NOT NULL
,	FOREIGN KEY ("device application") REFERENCES "device-belongs to-application" ("id")
,	UNIQUE("device application", "name")
);

INSERT INTO "device application environment variable" (
	SELECT
		dev."created at",
		dev."modified at",
		da.id AS "device application",
		dev."name",
		dev."id",
		dev."value"
	FROM "device environment variable" dev
	JOIN "device" d ON dev."device" = d."id"
	JOIN "device-belongs to-application" da ON da."device" = d."id"
);

DROP TABLE "device environment variable";
