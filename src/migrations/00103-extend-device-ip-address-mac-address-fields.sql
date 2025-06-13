DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'device'
			AND tc.constraint_name = 'device$fb1BIgBacXVJ9bZnwYm8QadL60wCwOBBtVPqW3kNi/s='
	) THEN
		ALTER TABLE "device"
		ADD CONSTRAINT "device$fb1BIgBacXVJ9bZnwYm8QadL60wCwOBBtVPqW3kNi/s=" CHECK (
			(NOT (("ip address" IS NOT NULL) AND (NOT ((length("ip address") <= 2000) AND (length("ip address") IS NOT NULL) AND ("ip address" IS NOT NULL)))))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'device'
			AND tc.constraint_name = 'device$lJTDYEcVIL9OLppQh03h38q1bjaSMr2kGNr1sLlEEvA='
	) THEN
		ALTER TABLE "device"
		ADD CONSTRAINT "device$lJTDYEcVIL9OLppQh03h38q1bjaSMr2kGNr1sLlEEvA=" CHECK (
			(NOT (("mac address" IS NOT NULL) AND (NOT ((length("mac address") <= 900) AND (length("mac address") IS NOT NULL) AND ("mac address" IS NOT NULL)))))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'service instance'
			AND tc.constraint_name = 'service instance$XlBWF+ef6mHIb+iS9NnT08mmd9+MyFk1+aT9vPjHehg='
	) THEN
		ALTER TABLE "service instance"
		ADD CONSTRAINT "service instance$XlBWF+ef6mHIb+iS9NnT08mmd9+MyFk1+aT9vPjHehg=" CHECK (
			((length("ip address") <= 255) AND (length("ip address") IS NOT NULL) AND ("ip address" IS NOT NULL))
		);
	END IF;
END;
$$;

ALTER TABLE "device"
ALTER COLUMN "ip address" SET DATA TYPE TEXT,
ALTER COLUMN "mac address" SET DATA TYPE TEXT;

ALTER TABLE "service instance"
ALTER COLUMN "ip address" SET DATA TYPE TEXT;
