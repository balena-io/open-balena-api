DROP TABLE IF EXISTS "testmassive";

CREATE TABLE IF NOT EXISTS "testmassive" (
	"created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
,	"id" BIGINT NOT NULL PRIMARY KEY
,	"columnA" VARCHAR(255) NOT NULL UNIQUE
,	"columnB" VARCHAR(255) NOT NULL
,	"columnC" VARCHAR(255) NULL
);


INSERT INTO "testmassive" (
    "id", "columnA", "columnB", "columnC"
)
SELECT
    i as "id",
    CONCAT('a',to_char(i,'900000')) as "columnA",
    CONCAT('b',to_char(i,'900000')) as "columnB",
    NULL as "columnC"
FROM generate_series(1, 200000) s(i);

