CREATE TABLE IF NOT EXISTS "user-has-public key" (
	"created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"user" INTEGER NOT NULL
,	"public key" TEXT NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	"title" VARCHAR(255) NOT NULL
,	FOREIGN KEY ("user") REFERENCES "user" ("id")
,	UNIQUE("user", "public key")
);

UPDATE "user" SET username='admin' WHERE username='root';
