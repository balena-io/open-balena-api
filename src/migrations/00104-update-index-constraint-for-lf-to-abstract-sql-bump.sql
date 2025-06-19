DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'application'
			AND tc.constraint_name = 'application$QqBV+60jro8TubDvmFVw6BwX9diAf/SNdJ1816Yxpx0='
	) THEN
		ALTER TABLE "application" ADD CONSTRAINT "application$QqBV+60jro8TubDvmFVw6BwX9diAf/SNdJ1816Yxpx0=" CHECK (
			((32 = LENGTH("uuid")) AND (LENGTH("uuid") IS NOT NULL) AND ("uuid" IS NOT NULL))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'image'
			AND tc.constraint_name = 'image$lZeBT9pF01RBiHpxC0g1n9T+XNyAo0tNDoPKEgREbfA='
	) THEN
		ALTER TABLE "image" ADD CONSTRAINT "image$lZeBT9pF01RBiHpxC0g1n9T+XNyAo0tNDoPKEgREbfA=" CHECK (
			(NOT (('success' = "status") AND ("status" IS NOT NULL) AND ("push timestamp" IS NULL)))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'scheduled job run'
			AND tc.constraint_name = 'scheduled job run$RKSl1c68Wu6bc7gqz25YsgDiydg6eJU5WorAXs6wPdk='
	) THEN
		ALTER TABLE "scheduled job run" ADD CONSTRAINT "scheduled job run$RKSl1c68Wu6bc7gqz25YsgDiydg6eJU5WorAXs6wPdk=" CHECK (
			(NOT (('success' = "status") AND ("status" IS NOT NULL) AND ("end timestamp" IS NULL)))
		);
	END IF;
END;
$$;

ALTER TABLE "application" DROP CONSTRAINT IF EXISTS "application$mZf6fIjTFZaZUdsCaYh/lnRvAxaNt8fVao0CoBFRPWM=";
ALTER TABLE "image" DROP CONSTRAINT IF EXISTS "image$f+RwXXr0uXiXbinfGuS+2KUJUP/5ZYRn0X2OTXgwKDw=";
ALTER TABLE "scheduled job run" DROP CONSTRAINT IF EXISTS "scheduled job run$wRT+EFBynm3yyXccCcMT2Jy+lMxnqwEmH8VyLPRJ02Q=";
