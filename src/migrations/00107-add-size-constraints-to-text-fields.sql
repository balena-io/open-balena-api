DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'api key'
			AND tc.constraint_name = 'api key$WIi1hzHsE7BNiWt0Mu65TeJLI+msputiiPog1eFUDC4='
	) THEN
		ALTER TABLE "api key" ADD CONSTRAINT "api key$WIi1hzHsE7BNiWt0Mu65TeJLI+msputiiPog1eFUDC4=" CHECK (
			(NOT (("description" IS NOT NULL) AND (NOT ((LENGTH("description") <= 1244) AND (LENGTH("description") IS NOT NULL) AND ("description" IS NOT NULL)))))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'api key'
			AND tc.constraint_name = 'api key$D14eZaZBafMEz7iBkiFFzvWJrzbdLPx8lH0CuwnDJhQ='
	) THEN
		ALTER TABLE "api key" ADD CONSTRAINT "api key$D14eZaZBafMEz7iBkiFFzvWJrzbdLPx8lH0CuwnDJhQ=" CHECK (
			(NOT (("name" IS NOT NULL) AND (NOT ((LENGTH("name") <= 1564) AND (LENGTH("name") IS NOT NULL) AND ("name" IS NOT NULL)))))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'application config variable'
			AND tc.constraint_name = 'application config variable$zuGUgVin2/r5dZjcrXLZxk/Dkn8+9v4o3cl'
	) THEN
		ALTER TABLE "application config variable" ADD CONSTRAINT "application config variable$zuGUgVin2/r5dZjcrXLZxk/Dkn8+9v4o3cl" CHECK (
			((LENGTH("value") <= 492001) AND (LENGTH("value") IS NOT NULL) AND ("value" IS NOT NULL))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'application environment variable'
			AND tc.constraint_name = 'application environment variab$iERNKCyyjU8L+R/9lHA7fEjnArvMYfIf'
	) THEN
		ALTER TABLE "application environment variable" ADD CONSTRAINT "application environment variab$iERNKCyyjU8L+R/9lHA7fEjnArvMYfIf" CHECK (
			((LENGTH("value") <= 106104) AND (LENGTH("value") IS NOT NULL) AND ("value" IS NOT NULL))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'application tag'
			AND tc.constraint_name = 'application tag$4hGLjoES4ZaBho9oObl2U8SQoB1fEM+V2MrqNWfvDkM='
	) THEN
		ALTER TABLE "application tag" ADD CONSTRAINT "application tag$4hGLjoES4ZaBho9oObl2U8SQoB1fEM+V2MrqNWfvDkM=" CHECK (
			((LENGTH("value") <= 1000) AND (LENGTH("value") IS NOT NULL) AND ("value" IS NOT NULL))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'application tag'
			AND tc.constraint_name = 'application tag$j9Wf5m4NL4H0Wdaiav02OJoe8eRqSOLgjp85Zq0tSB0='
	) THEN
		ALTER TABLE "application tag" ADD CONSTRAINT "application tag$j9Wf5m4NL4H0Wdaiav02OJoe8eRqSOLgjp85Zq0tSB0=" CHECK (
			((0 < LENGTH("tag key")) AND (LENGTH("tag key") <= 100) AND (LENGTH("tag key") IS NOT NULL) AND ("tag key" = "tag key") AND ("tag key" IS NOT NULL))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'application type'
			AND tc.constraint_name = 'application type$o2U/ctsdwCkTSTuXkF58hjsXswo7e2qshi+6v/J/6nE='
	) THEN
		ALTER TABLE "application type" ADD CONSTRAINT "application type$o2U/ctsdwCkTSTuXkF58hjsXswo7e2qshi+6v/J/6nE=" CHECK (
			(NOT (("description" IS NOT NULL) AND (NOT ((LENGTH("description") <= 200) AND (LENGTH("description") IS NOT NULL) AND ("description" IS NOT NULL)))))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'application type'
			AND tc.constraint_name = 'application type$y1MbZ7ZTtBtuCl6ThKVwsrPQuZ5pTkPGILA6N3FdWKg='
	) THEN
		ALTER TABLE "application type" ADD CONSTRAINT "application type$y1MbZ7ZTtBtuCl6ThKVwsrPQuZ5pTkPGILA6N3FdWKg=" CHECK (
			((LENGTH("name") <= 20) AND (LENGTH("name") IS NOT NULL) AND ("name" IS NOT NULL))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'application type'
			AND tc.constraint_name = 'application type$deaephbCCBNi6a6pEHwDIBDQXvRmpN+HqivvtOtC4I0='
	) THEN
		ALTER TABLE "application type" ADD CONSTRAINT "application type$deaephbCCBNi6a6pEHwDIBDQXvRmpN+HqivvtOtC4I0=" CHECK (
			(NOT (("needs-os version range" IS NOT NULL) AND (NOT ((LENGTH("needs-os version range") <= 50) AND (LENGTH("needs-os version range") IS NOT NULL) AND ("needs-os version range" IS NOT NULL)))))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'application type'
			AND tc.constraint_name = 'application type$BM6a7+9yob/U+BSeObP4YWVjudRPgpfcIxSly/zN+P4='
	) THEN
		ALTER TABLE "application type" ADD CONSTRAINT "application type$BM6a7+9yob/U+BSeObP4YWVjudRPgpfcIxSly/zN+P4=" CHECK (
			((LENGTH("slug") <= 30) AND (LENGTH("slug") IS NOT NULL) AND ("slug" IS NOT NULL))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'application'
			AND tc.constraint_name = 'application$uhNDYRj3nKwlqNLzYzPgnUFyiRKag1EX8HzXmpo/qSQ='
	) THEN
		ALTER TABLE "application" ADD CONSTRAINT "application$uhNDYRj3nKwlqNLzYzPgnUFyiRKag1EX8HzXmpo/qSQ=" CHECK (
			((6 <= LENGTH("slug")) AND (LENGTH("slug") <= 321) AND (LENGTH("slug") IS NOT NULL) AND ("slug" IS NOT NULL))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'device config variable'
			AND tc.constraint_name = 'device config variable$zpEXF7xuJN2iSYr4G9BWhznwRJ/OpvfQUcd2A7Go'
	) THEN
		ALTER TABLE "device config variable" ADD CONSTRAINT "device config variable$zpEXF7xuJN2iSYr4G9BWhznwRJ/OpvfQUcd2A7Go" CHECK (
			((LENGTH("value") <= 372340) AND (LENGTH("value") IS NOT NULL) AND ("value" IS NOT NULL))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'device environment variable'
			AND tc.constraint_name = 'device environment variable$xCV3+8xgEN8hbXVFrLUXKnWp2tzt3TuE//S'
	) THEN
		ALTER TABLE "device environment variable" ADD CONSTRAINT "device environment variable$xCV3+8xgEN8hbXVFrLUXKnWp2tzt3TuE//S" CHECK (
			((LENGTH("value") <= 515798) AND (LENGTH("value") IS NOT NULL) AND ("value" IS NOT NULL))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'device family'
			AND tc.constraint_name = 'device family$5CK5C9xXEtO/tF6WXcV9mc0OYNrOevNqIJo1fJhGm/o='
	) THEN
		ALTER TABLE "device family" ADD CONSTRAINT "device family$5CK5C9xXEtO/tF6WXcV9mc0OYNrOevNqIJo1fJhGm/o=" CHECK (
			((LENGTH("name") <= 50) AND (LENGTH("name") IS NOT NULL) AND ("name" IS NOT NULL))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'device family'
			AND tc.constraint_name = 'device family$e1SUyrOgWA2l1/Pp/1yTBLMMBkWG6DNkreNARUZTZXQ='
	) THEN
		ALTER TABLE "device family" ADD CONSTRAINT "device family$e1SUyrOgWA2l1/Pp/1yTBLMMBkWG6DNkreNARUZTZXQ=" CHECK (
			((LENGTH("slug") <= 50) AND (LENGTH("slug") IS NOT NULL) AND ("slug" IS NOT NULL))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'device manufacturer'
			AND tc.constraint_name = 'device manufacturer$8r+TxV4METG0sirYjAGckWXOZceBV+DTAmIT4Z3AJv8'
	) THEN
		ALTER TABLE "device manufacturer" ADD CONSTRAINT "device manufacturer$8r+TxV4METG0sirYjAGckWXOZceBV+DTAmIT4Z3AJv8" CHECK (
			((LENGTH("name") <= 100) AND (LENGTH("name") IS NOT NULL) AND ("name" IS NOT NULL))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'device manufacturer'
			AND tc.constraint_name = 'device manufacturer$uXh2pp3ittmVyXk6iF30jkQH9lsMwrGZhx76+8nfNUo'
	) THEN
		ALTER TABLE "device manufacturer" ADD CONSTRAINT "device manufacturer$uXh2pp3ittmVyXk6iF30jkQH9lsMwrGZhx76+8nfNUo" CHECK (
			((LENGTH("slug") <= 50) AND (LENGTH("slug") IS NOT NULL) AND ("slug" IS NOT NULL))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'device service environment variable'
			AND tc.constraint_name = 'device service environment var$dSF1WVorgNJcspccMKJuZf9WhpZc/+Ou'
	) THEN
		ALTER TABLE "device service environment variable" ADD CONSTRAINT "device service environment var$dSF1WVorgNJcspccMKJuZf9WhpZc/+Ou" CHECK (
			((LENGTH("value") <= 285082) AND (LENGTH("value") IS NOT NULL) AND ("value" IS NOT NULL))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'device tag'
			AND tc.constraint_name = 'device tag$azU8VEWffh5ov5y3yR0MLBIFZMhCBS7fkmP5EJ3czxM='
	) THEN
		ALTER TABLE "device tag" ADD CONSTRAINT "device tag$azU8VEWffh5ov5y3yR0MLBIFZMhCBS7fkmP5EJ3czxM=" CHECK (
		((LENGTH("value") <= 60158) AND (LENGTH("value") IS NOT NULL) AND ("value" IS NOT NULL))
	);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'device tag'
			AND tc.constraint_name = 'device tag$bLlKamyFfbVTuJXbFMCAuJNGt2jX3XAO0B+xjD6zTk4='
	) THEN
		ALTER TABLE "device tag" ADD CONSTRAINT "device tag$bLlKamyFfbVTuJXbFMCAuJNGt2jX3XAO0B+xjD6zTk4=" CHECK (
			((0 < LENGTH("tag key")) AND (LENGTH("tag key") <= 100) AND (LENGTH("tag key") IS NOT NULL) AND ("tag key" = "tag key") AND ("tag key" IS NOT NULL))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'device type'
			AND tc.constraint_name = 'device type$3i8Hd/KFoExqr2q68EgmmqwSpATrQggFxhjHfR4WgZ0='
	) THEN
		ALTER TABLE "device type" ADD CONSTRAINT "device type$3i8Hd/KFoExqr2q68EgmmqwSpATrQggFxhjHfR4WgZ0=" CHECK (
			(NOT (("logo" IS NOT NULL) AND (NOT ((LENGTH("logo") <= 400000) AND (LENGTH("logo") IS NOT NULL) AND ("logo" IS NOT NULL)))))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'device'
			AND tc.constraint_name = 'device$PVpaiOWKOTJSOmoj9jRytDCd4SW6rTBlUG8qFiy8hrM='
	) THEN
		ALTER TABLE "device" ADD CONSTRAINT "device$PVpaiOWKOTJSOmoj9jRytDCd4SW6rTBlUG8qFiy8hrM=" CHECK (
			(NOT (("api secret" IS NOT NULL) AND (NOT ((LENGTH("api secret") <= 64) AND (LENGTH("api secret") IS NOT NULL) AND ("api secret" IS NOT NULL)))))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'device'
			AND tc.constraint_name = 'device$T0NS30yloBpJCwbER2J1DK/zh5uvAK8u4FvtZhvF6N8='
	) THEN
		ALTER TABLE "device" ADD CONSTRAINT "device$T0NS30yloBpJCwbER2J1DK/zh5uvAK8u4FvtZhvF6N8=" CHECK (
			(NOT (("note" IS NOT NULL) AND (NOT ((LENGTH("note") <= 1000000) AND (LENGTH("note") IS NOT NULL) AND ("note" IS NOT NULL)))))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'device'
			AND tc.constraint_name = 'device$uNX8A20zUEqxWlbd+5xeYZ3RuhmY865OJmYcejzNoqQ='
	) THEN
		ALTER TABLE "device" ADD CONSTRAINT "device$uNX8A20zUEqxWlbd+5xeYZ3RuhmY865OJmYcejzNoqQ=" CHECK (
			(NOT (("os version" IS NOT NULL) AND (NOT ((LENGTH("os version") <= 70) AND (LENGTH("os version") IS NOT NULL) AND ("os version" IS NOT NULL)))))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'device'
			AND tc.constraint_name = 'device$+AVDrJqqQBccjS4mNqmCYDhWYYv7FVNMU4ULzAuEifI='
	) THEN
		ALTER TABLE "device" ADD CONSTRAINT "device$+AVDrJqqQBccjS4mNqmCYDhWYYv7FVNMU4ULzAuEifI=" CHECK (
			(NOT (("public address" IS NOT NULL) AND (NOT ((LENGTH("public address") <= 50) AND (LENGTH("public address") IS NOT NULL) AND ("public address" IS NOT NULL)))))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'device'
			AND tc.constraint_name = 'device$X0YzSiZ6Lt/Um62s7PKwlIe1/Km9tupQLqqV7JMuwms='
	) THEN
		ALTER TABLE "device" ADD CONSTRAINT "device$X0YzSiZ6Lt/Um62s7PKwlIe1/Km9tupQLqqV7JMuwms=" CHECK (
			(NOT (("status" IS NOT NULL) AND (NOT ((LENGTH("status") <= 50) AND (LENGTH("status") IS NOT NULL) AND ("status" IS NOT NULL)))))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'device'
			AND tc.constraint_name = 'device$gKTWnM0Y80zEFpXOmrVYVkgusm/g4KolYU9tIsIt9Vg='
	) THEN
		ALTER TABLE "device" ADD CONSTRAINT "device$gKTWnM0Y80zEFpXOmrVYVkgusm/g4KolYU9tIsIt9Vg=" CHECK (
			(NOT (("supervisor version" IS NOT NULL) AND (NOT ((LENGTH("supervisor version") <= 20) AND (LENGTH("supervisor version") IS NOT NULL) AND ("supervisor version" IS NOT NULL)))))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'device'
			AND tc.constraint_name = 'device$yVXGBAKzkNuKc6G1y/rxK4tT5cRBK2C3T1GmD45UaVc='
	) THEN
		ALTER TABLE "device" ADD CONSTRAINT "device$yVXGBAKzkNuKc6G1y/rxK4tT5cRBK2C3T1GmD45UaVc=" CHECK (
			((LENGTH("uuid") <= 62) AND (LENGTH("uuid") IS NOT NULL) AND ("uuid" IS NOT NULL))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'image environment variable'
			AND tc.constraint_name = 'image environment variable$TbKRc+ln6RepKj4sOtt4nnD97k7tsn8JmHOA'
	) THEN
		ALTER TABLE "image environment variable" ADD CONSTRAINT "image environment variable$TbKRc+ln6RepKj4sOtt4nnD97k7tsn8JmHOA" CHECK (
			((LENGTH("value") <= 100000) AND (LENGTH("value") IS NOT NULL) AND ("value" IS NOT NULL))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'image label'
			AND tc.constraint_name = 'image label$0n2pK6RVL5TmYL21xk3D1O9scmE9eh4CZRvixwJZ3/g='
	) THEN
		ALTER TABLE "image label" ADD CONSTRAINT "image label$0n2pK6RVL5TmYL21xk3D1O9scmE9eh4CZRvixwJZ3/g=" CHECK (
			((LENGTH("value") <= 300) AND (LENGTH("value") IS NOT NULL) AND ("value" IS NOT NULL))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'image'
			AND tc.constraint_name = 'image$a5cf+NYvqBdneM1eIrUd3KctCuQEkOE2ffvPM5U9r3E='
	) THEN
		ALTER TABLE "image" ADD CONSTRAINT "image$a5cf+NYvqBdneM1eIrUd3KctCuQEkOE2ffvPM5U9r3E=" CHECK (
			(NOT (("build log" IS NOT NULL) AND (NOT ((LENGTH("build log") <= 1500000) AND (LENGTH("build log") IS NOT NULL) AND ("build log" IS NOT NULL)))))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'image'
			AND tc.constraint_name = 'image$I1L+rmqo4aZ8kBZhS9YWAimEi+NGDqli0w0WGJYjMYo='
	) THEN
		ALTER TABLE "image" ADD CONSTRAINT "image$I1L+rmqo4aZ8kBZhS9YWAimEi+NGDqli0w0WGJYjMYo=" CHECK (
			(NOT (("content hash" IS NOT NULL) AND (NOT ((LENGTH("content hash") <= 71) AND (LENGTH("content hash") IS NOT NULL) AND ("content hash" IS NOT NULL)))))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'image'
			AND tc.constraint_name = 'image$C7YrBi2jZ0odZTxgGQI2coLXUUgQmf16eYWeEP9A7YE='
	) THEN
		ALTER TABLE "image" ADD CONSTRAINT "image$C7YrBi2jZ0odZTxgGQI2coLXUUgQmf16eYWeEP9A7YE=" CHECK (
			(NOT (("dockerfile" IS NOT NULL) AND (NOT ((LENGTH("dockerfile") <= 1000000) AND (LENGTH("dockerfile") IS NOT NULL) AND ("dockerfile" IS NOT NULL)))))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'image'
			AND tc.constraint_name = 'image$6zLjifAAD8qog+FZclOL+ndEwxJflN1VGrsFxVKGiuA='
	) THEN
		ALTER TABLE "image" ADD CONSTRAINT "image$6zLjifAAD8qog+FZclOL+ndEwxJflN1VGrsFxVKGiuA=" CHECK (
			(NOT (("error message" IS NOT NULL) AND (NOT ((LENGTH("error message") <= 300000) AND (LENGTH("error message") IS NOT NULL) AND ("error message" IS NOT NULL)))))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'organization'
			AND tc.constraint_name = 'organization$DN8LTPH8e//MAdHWNc1DcIDLi7uMbG+5W0ZCEhiiICU='
	) THEN
		ALTER TABLE "organization" ADD CONSTRAINT "organization$DN8LTPH8e//MAdHWNc1DcIDLi7uMbG+5W0ZCEhiiICU=" CHECK (
			((0 < LENGTH("handle")) AND (LENGTH("handle") <= 220) AND (LENGTH("handle") IS NOT NULL))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'organization'
			AND tc.constraint_name = 'organization$ARGEZDGHaW5rlDPv2czVCKxC6qbDFVEKx1c2/PSOboE='
	) THEN
		ALTER TABLE "organization" ADD CONSTRAINT "organization$ARGEZDGHaW5rlDPv2czVCKxC6qbDFVEKx1c2/PSOboE=" CHECK (
			((0 < LENGTH("name")) AND (LENGTH("name") <= 220) AND (LENGTH("name") IS NOT NULL))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'release tag'
			AND tc.constraint_name = 'release tag$or0ukbHG5sOwbDbRv83QWCxwR9PWg7O+YI2juW53aH0='
	) THEN
		ALTER TABLE "release tag" ADD CONSTRAINT "release tag$or0ukbHG5sOwbDbRv83QWCxwR9PWg7O+YI2juW53aH0=" CHECK (
			((LENGTH("value") <= 1000) AND (LENGTH("value") IS NOT NULL) AND ("value" IS NOT NULL))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'release tag'
			AND tc.constraint_name = 'release tag$NygXOml14ySTizP+kkHU2SHweeb3xOhYZopc51IWTOo='
	) THEN
		ALTER TABLE "release tag" ADD CONSTRAINT "release tag$NygXOml14ySTizP+kkHU2SHweeb3xOhYZopc51IWTOo=" CHECK (
			((0 < LENGTH("tag key")) AND (LENGTH("tag key") <= 164) AND (LENGTH("tag key") IS NOT NULL) AND ("tag key" = "tag key") AND ("tag key" IS NOT NULL))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'release'
			AND tc.constraint_name = 'release$FraOd3cs8onDZkJEgL2wkrhZJBIcej1ADZ0R08/kMw0='
	) THEN
		ALTER TABLE "release" ADD CONSTRAINT "release$FraOd3cs8onDZkJEgL2wkrhZJBIcej1ADZ0R08/kMw0=" CHECK (
			(NOT (("build log" IS NOT NULL) AND (NOT ((LENGTH("build log") <= 1000000) AND (LENGTH("build log") IS NOT NULL) AND ("build log" IS NOT NULL)))))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'release'
			AND tc.constraint_name = 'release$XgsnsDckOab+Bq2NHawav6V16yLnQaZcMIIZqY1q+yI='
	) THEN
		ALTER TABLE "release" ADD CONSTRAINT "release$XgsnsDckOab+Bq2NHawav6V16yLnQaZcMIIZqY1q+yI=" CHECK (
			((LENGTH("commit") <= 40) AND (LENGTH("commit") IS NOT NULL) AND ("commit" IS NOT NULL))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'release'
			AND tc.constraint_name = 'release$L91n+PaXJQjvKeXDm++JCGcLpF4n/xFkKpkDF5Ii8HA='
	) THEN
		ALTER TABLE "release" ADD CONSTRAINT "release$L91n+PaXJQjvKeXDm++JCGcLpF4n/xFkKpkDF5Ii8HA=" CHECK (
			(NOT (("invalidation reason" IS NOT NULL) AND (NOT ((LENGTH("invalidation reason") <= 255) AND (LENGTH("invalidation reason") IS NOT NULL) AND ("invalidation reason" IS NOT NULL)))))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'release'
			AND tc.constraint_name = 'release$WGUZ59vzU4rO41GVUxxLwHpnLhU520fxV0FURL0bBg4='
	) THEN
		ALTER TABLE "release" ADD CONSTRAINT "release$WGUZ59vzU4rO41GVUxxLwHpnLhU520fxV0FURL0bBg4=" CHECK (
			(NOT (("known issue list" IS NOT NULL) AND (NOT ((LENGTH("known issue list") <= 1000) AND (LENGTH("known issue list") IS NOT NULL) AND ("known issue list" IS NOT NULL)))))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'release'
			AND tc.constraint_name = 'release$R7G+xosXdG+jq15earfczb8VYF0wN0s1d3cpvawx6D0='
	) THEN
		ALTER TABLE "release" ADD CONSTRAINT "release$R7G+xosXdG+jq15earfczb8VYF0wN0s1d3cpvawx6D0=" CHECK (
			(NOT (("note" IS NOT NULL) AND (NOT ((LENGTH("note") <= 1000000) AND (LENGTH("note") IS NOT NULL) AND ("note" IS NOT NULL)))))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'release'
			AND tc.constraint_name = 'release$JG36BOkOVLyjyywlXGrcviEma972s+IRBvlFq8VF+d4='
	) THEN
		ALTER TABLE "release" ADD CONSTRAINT "release$JG36BOkOVLyjyywlXGrcviEma972s+IRBvlFq8VF+d4=" CHECK (
			(NOT (("release version" IS NOT NULL) AND (NOT ((LENGTH("release version") <= 81) AND (LENGTH("release version") IS NOT NULL) AND ("release version" IS NOT NULL)))))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'release'
			AND tc.constraint_name = 'release$vC+8m6xxIKgojMs8q0quJv+4Dk7z/z5cGAIklESQmME='
	) THEN
		ALTER TABLE "release" ADD CONSTRAINT "release$vC+8m6xxIKgojMs8q0quJv+4Dk7z/z5cGAIklESQmME=" CHECK (
			((LENGTH("semver build") <= 50) AND (LENGTH("semver build") IS NOT NULL) AND ("semver build" IS NOT NULL))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'release'
			AND tc.constraint_name = 'release$m/Zmcp7QAV2z2ww2wx3q0mZJlE/nFNP7aRX9/HpyLP0='
	) THEN
		ALTER TABLE "release" ADD CONSTRAINT "release$m/Zmcp7QAV2z2ww2wx3q0mZJlE/nFNP7aRX9/HpyLP0=" CHECK (
			((LENGTH("semver prerelease") <= 100) AND (LENGTH("semver prerelease") IS NOT NULL) AND ("semver prerelease" IS NOT NULL))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'release'
			AND tc.constraint_name = 'release$OqLTBCkFsFoV5duV5NecNU5yeaxALCyNAbAcUk01mT4='
	) THEN
		ALTER TABLE "release" ADD CONSTRAINT "release$OqLTBCkFsFoV5duV5NecNU5yeaxALCyNAbAcUk01mT4=" CHECK (
			((LENGTH("variant") <= 50) AND (LENGTH("variant") IS NOT NULL) AND ("variant" IS NOT NULL))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'service environment variable'
			AND tc.constraint_name = 'service environment variable$jwEy69R+ZEJMCNMWdecMx6b2hx556ix2+J'
	) THEN
		ALTER TABLE "service environment variable" ADD CONSTRAINT "service environment variable$jwEy69R+ZEJMCNMWdecMx6b2hx556ix2+J" CHECK (
			((LENGTH("value") <= 100000) AND (LENGTH("value") IS NOT NULL) AND ("value" IS NOT NULL))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'service instance'
			AND tc.constraint_name = 'service instance$pzSOrCcd3nDQlBpNLcb+0Lql1h7gVd2Z4lj0fRSSOAI='
	) THEN
		ALTER TABLE "service instance" ADD CONSTRAINT "service instance$pzSOrCcd3nDQlBpNLcb+0Lql1h7gVd2Z4lj0fRSSOAI=" CHECK (
			((LENGTH("ip address") <= 39) AND (LENGTH("ip address") IS NOT NULL) AND ("ip address" IS NOT NULL))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'service label'
			AND tc.constraint_name = 'service label$zyXVgnDunvKwsxLqFZDXfPVooJF8CtsoEahfGsuCaIY='
	) THEN
		ALTER TABLE "service label" ADD CONSTRAINT "service label$zyXVgnDunvKwsxLqFZDXfPVooJF8CtsoEahfGsuCaIY=" CHECK (
			((LENGTH("value") <= 300) AND (LENGTH("value") IS NOT NULL) AND ("value" IS NOT NULL))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'service'
			AND tc.constraint_name = 'service$aZ/wmHII89+UYicF2hwv9lsXM+1ljNCknhiLzOs1Lv8='
	) THEN
		ALTER TABLE "service" ADD CONSTRAINT "service$aZ/wmHII89+UYicF2hwv9lsXM+1ljNCknhiLzOs1Lv8=" CHECK (
			((0 < LENGTH("service name")) AND (LENGTH("service name") <= 63) AND (LENGTH("service name") IS NOT NULL) AND ("service name" = "service name") AND ("service name" IS NOT NULL))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'user'
			AND tc.constraint_name = 'user$X4wTdmwFnA5OK/O8sut0Idrym4db2iVYraIIJSST5GY='
	) THEN
		ALTER TABLE "user" ADD CONSTRAINT "user$X4wTdmwFnA5OK/O8sut0Idrym4db2iVYraIIJSST5GY=" CHECK (
			((LENGTH("username") <= 73) AND (LENGTH("username") IS NOT NULL) AND ("username" IS NOT NULL))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'user'
			AND tc.constraint_name = 'user$d5eBtWZrArLycRLjuBoVdWS/P4w6MdcM5lTjNKTcxQ4='
	) THEN
		ALTER TABLE "user" ADD CONSTRAINT "user$d5eBtWZrArLycRLjuBoVdWS/P4w6MdcM5lTjNKTcxQ4=" CHECK (
			(NOT (("email" IS NOT NULL) AND (NOT ((4 < LENGTH("email")) AND (LENGTH("email") <= 254) AND (LENGTH("email") IS NOT NULL) AND ("email" IS NOT NULL)))))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'user-has-public key'
			AND tc.constraint_name = 'user-has-public key$qB+XKZScFYvYhfCNGG6PdVHKSZourbyKd1gZ82PXG04'
	) THEN
		ALTER TABLE "user-has-public key" ADD CONSTRAINT "user-has-public key$qB+XKZScFYvYhfCNGG6PdVHKSZourbyKd1gZ82PXG04" CHECK (
			((LENGTH("public key") <= 2850) AND (LENGTH("public key") IS NOT NULL) AND ("public key" = "public key") AND ("public key" IS NOT NULL))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'user-has-public key'
			AND tc.constraint_name = 'user-has-public key$y39DNi0GgwQ/0UtT65zSPk1Z1YPZZLHdcBfx/htSfgo'
	) THEN
		ALTER TABLE "user-has-public key" ADD CONSTRAINT "user-has-public key$y39DNi0GgwQ/0UtT65zSPk1Z1YPZZLHdcBfx/htSfgo" CHECK (
			((LENGTH("title") <= 120) AND (LENGTH("title") IS NOT NULL) AND ("title" IS NOT NULL))
		);
	END IF;

	ALTER TABLE "application tag" DROP CONSTRAINT IF EXISTS "application tag$dwaIlc8ofrxW9EuuGVg2l/mONXLOEwBOKBKuMMh0y84=";
	ALTER TABLE "device tag" DROP CONSTRAINT IF EXISTS "device tag$LxFNw830+UStHqiMds2etP37dS5mqJP1LWfVi6p8xO0=";
	ALTER TABLE "organization" DROP CONSTRAINT IF EXISTS "organization$E+cBryACQrrUVLO1vZD8cqyxwba+nOu+T7UYno7mUZ0=";
	ALTER TABLE "organization" DROP CONSTRAINT IF EXISTS "organization$/jm+9cFLOktW7UDAih9SkCWgaZxrnJBTAFjsx8Lrc7A=";
	ALTER TABLE "release tag" DROP CONSTRAINT IF EXISTS "release tag$NvLy4YiKcvnAIsymFg0q5h0woCgrL3NW7FzZLrc6S9E=";
	ALTER TABLE "service instance" DROP CONSTRAINT IF EXISTS "service instance$XlBWF+ef6mHIb+iS9NnT08mmd9+MyFk1+aT9vPjHehg=";
	ALTER TABLE "user" DROP CONSTRAINT IF EXISTS "user$M+9koFfMHn7kQFDNBaQZbS7gAvNMB1QkrTtsaVZoETw=";
END;
$$;
