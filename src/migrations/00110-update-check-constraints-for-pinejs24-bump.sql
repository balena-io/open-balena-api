DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'application tag'
			AND tc.constraint_name = 'application tag$8j5V3VqJ6ueyTpVGlcK7bYNia2rv5128N9V3nrk3ReI='
	) THEN
		ALTER TABLE "application tag" ADD CONSTRAINT "application tag$8j5V3VqJ6ueyTpVGlcK7bYNia2rv5128N9V3nrk3ReI=" CHECK (
			((0 < LENGTH("tag key")) AND (LENGTH("tag key") <= 100) AND (LENGTH("tag key") IS NOT NULL) AND ("tag key" IS NOT NULL))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'device tag'
			AND tc.constraint_name = 'device tag$z2PT93BdIl9C8h3wK1tmwa+zIcdXsXjz/Rh5X+aka8o='
	) THEN
		ALTER TABLE "device tag" ADD CONSTRAINT "device tag$z2PT93BdIl9C8h3wK1tmwa+zIcdXsXjz/Rh5X+aka8o=" CHECK (
			((0 < LENGTH("tag key")) AND (LENGTH("tag key") <= 100) AND (LENGTH("tag key") IS NOT NULL) AND ("tag key" IS NOT NULL))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'release asset'
			AND tc.constraint_name = 'release asset$qOx6FKU3K2Fy5HCvdix0nNXyEGc4LebcIAt45vJcsiw='
	) THEN
		ALTER TABLE "release asset" ADD CONSTRAINT "release asset$qOx6FKU3K2Fy5HCvdix0nNXyEGc4LebcIAt45vJcsiw=" CHECK (
			((0 < LENGTH("asset key")) AND (LENGTH("asset key") IS NOT NULL) AND ("asset key" IS NOT NULL))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'release tag'
			AND tc.constraint_name = 'release tag$7iRVGIhUQQPVfYQwj5aBHI0vXwyoAGjSdIOIyJe4J1k='
	) THEN
		ALTER TABLE "release tag" ADD CONSTRAINT "release tag$7iRVGIhUQQPVfYQwj5aBHI0vXwyoAGjSdIOIyJe4J1k=" CHECK (
			((0 < LENGTH("tag key")) AND (LENGTH("tag key") <= 164) AND (LENGTH("tag key") IS NOT NULL) AND ("tag key" IS NOT NULL))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'service'
			AND tc.constraint_name = 'service$Aclcq2z7ubxc/wg4f3EioL4Y166+0fUGx32B2v+YMyY='
	) THEN
		ALTER TABLE "service" ADD CONSTRAINT "service$Aclcq2z7ubxc/wg4f3EioL4Y166+0fUGx32B2v+YMyY=" CHECK (
			((0 < LENGTH("service name")) AND (LENGTH("service name") <= 63) AND (LENGTH("service name") IS NOT NULL) AND ("service name" IS NOT NULL))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'user-has-public key'
			AND tc.constraint_name = 'user-has-public key$HUE5Nrf8QUBrWBHlKj3eXESRHlgx0Jne3u0Ac+sSjB8'
	) THEN
		ALTER TABLE "user-has-public key" ADD CONSTRAINT "user-has-public key$HUE5Nrf8QUBrWBHlKj3eXESRHlgx0Jne3u0Ac+sSjB8" CHECK (
			((LENGTH("public key") <= 2850) AND (LENGTH("public key") IS NOT NULL) AND ("public key" IS NOT NULL))
		);
	END IF;
END;
$$;

ALTER TABLE "application tag" DROP CONSTRAINT IF EXISTS "application tag$j9Wf5m4NL4H0Wdaiav02OJoe8eRqSOLgjp85Zq0tSB0=";
ALTER TABLE "device tag" DROP CONSTRAINT IF EXISTS "device tag$bLlKamyFfbVTuJXbFMCAuJNGt2jX3XAO0B+xjD6zTk4=";
ALTER TABLE "release asset" DROP CONSTRAINT IF EXISTS "release asset$p9L6VYTv4TOtRNnzupzjcGioRwtUZeiq0c2vYbePKko=";
ALTER TABLE "release tag" DROP CONSTRAINT IF EXISTS "release tag$NygXOml14ySTizP+kkHU2SHweeb3xOhYZopc51IWTOo=";
ALTER TABLE "service" DROP CONSTRAINT IF EXISTS "service$aZ/wmHII89+UYicF2hwv9lsXM+1ljNCknhiLzOs1Lv8=";
ALTER TABLE "user-has-public key" DROP CONSTRAINT IF EXISTS "user-has-public key$qB+XKZScFYvYhfCNGG6PdVHKSZourbyKd1gZ82PXG04";
