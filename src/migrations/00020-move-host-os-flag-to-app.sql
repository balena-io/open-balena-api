ALTER TABLE "application" ADD COLUMN "is host" INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE "application type" DROP COLUMN "is host os";
