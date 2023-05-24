-- Boolean type conversions

ALTER TABLE "application type"
ALTER COLUMN "supports web url" DROP DEFAULT,
ALTER COLUMN "supports multicontainer" DROP DEFAULT,
ALTER COLUMN "supports gateway mode" DROP DEFAULT,
ALTER COLUMN "requires payment" DROP DEFAULT,
ALTER COLUMN "is legacy" DROP DEFAULT,
ALTER COLUMN "supports web url" SET DATA TYPE BOOLEAN USING "supports web url"::BOOLEAN,
ALTER COLUMN "supports multicontainer" SET DATA TYPE BOOLEAN USING "supports multicontainer"::BOOLEAN,
ALTER COLUMN "supports gateway mode" SET DATA TYPE BOOLEAN USING "supports gateway mode"::BOOLEAN,
ALTER COLUMN "requires payment" SET DATA TYPE BOOLEAN USING "requires payment"::BOOLEAN,
ALTER COLUMN "is legacy" SET DATA TYPE BOOLEAN USING "is legacy"::BOOLEAN,
ALTER COLUMN "supports web url" SET DEFAULT FALSE,
ALTER COLUMN "supports multicontainer" SET DEFAULT FALSE,
ALTER COLUMN "supports gateway mode" SET DEFAULT FALSE,
ALTER COLUMN "requires payment" SET DEFAULT FALSE,
ALTER COLUMN "is legacy" SET DEFAULT FALSE;

ALTER TABLE "application"
ALTER COLUMN "should track latest release" DROP DEFAULT,
ALTER COLUMN "is host" DROP DEFAULT,
ALTER COLUMN "is archived" DROP DEFAULT,
ALTER COLUMN "is public" DROP DEFAULT,
ALTER COLUMN "should track latest release" SET DATA TYPE BOOLEAN USING "should track latest release"::BOOLEAN,
ALTER COLUMN "is host" SET DATA TYPE BOOLEAN USING "is host"::BOOLEAN,
ALTER COLUMN "is archived" SET DATA TYPE BOOLEAN USING "is archived"::BOOLEAN,
ALTER COLUMN "is public" SET DATA TYPE BOOLEAN USING "is public"::BOOLEAN,
ALTER COLUMN "should track latest release" SET DEFAULT FALSE,
ALTER COLUMN "is host" SET DEFAULT FALSE,
ALTER COLUMN "is archived" SET DEFAULT FALSE,
ALTER COLUMN "is public" SET DEFAULT FALSE;

ALTER TABLE "device"
ALTER COLUMN "is online" DROP DEFAULT,
ALTER COLUMN "is connected to vpn" DROP DEFAULT,
ALTER COLUMN "is undervolted" DROP DEFAULT,
ALTER COLUMN "is online" SET DATA TYPE BOOLEAN USING "is online"::BOOLEAN,
ALTER COLUMN "is connected to vpn" SET DATA TYPE BOOLEAN USING "is connected to vpn"::BOOLEAN,
ALTER COLUMN "is undervolted" SET DATA TYPE BOOLEAN USING "is undervolted"::BOOLEAN,
ALTER COLUMN "is online" SET DEFAULT FALSE,
ALTER COLUMN "is connected to vpn" SET DEFAULT FALSE,
ALTER COLUMN "is undervolted" SET DEFAULT FALSE;

ALTER TABLE "release"
DROP CONSTRAINT IF EXISTS "release$4VHBqaOH1cZHOsRGD2NvfC+SbBdzlb1ZY/X5Nf4LYrk=",
ALTER COLUMN "is invalidated" DROP DEFAULT,
ALTER COLUMN "is passing tests" DROP DEFAULT,
ALTER COLUMN "is invalidated" SET DATA TYPE BOOLEAN USING "is invalidated"::BOOLEAN,
ALTER COLUMN "is passing tests" SET DATA TYPE BOOLEAN USING "is passing tests"::BOOLEAN,
ALTER COLUMN "is invalidated" SET DEFAULT FALSE,
ALTER COLUMN "is passing tests" SET DEFAULT TRUE,
ADD CONSTRAINT "release$4VHBqaOH1cZHOsRGD2NvfC+SbBdzlb1ZY/X5Nf4LYrk=" CHECK (NOT (
	"invalidation reason" IS NOT NULL
	AND "is invalidated" != TRUE
));


-- JSON type conversions

ALTER TABLE "device type"
ALTER COLUMN "contract" SET DATA TYPE JSONB USING "contract"::JSONB;

ALTER TABLE "image"
ALTER COLUMN "contract" SET DATA TYPE JSONB USING "contract"::JSONB;

ALTER TABLE "release"
ALTER COLUMN "composition" SET DATA TYPE JSONB USING "composition"::JSONB,
ALTER COLUMN "contract" SET DATA TYPE JSONB USING "contract"::JSONB;
