ALTER TABLE "organization"
	-- It is necessary that each name (Auth) of an organization, has a Length (Type) that is greater than 0.
	ADD CONSTRAINT "organization$E+cBryACQrrUVLO1vZD8cqyxwba+nOu+T7UYno7mUZ0=" CHECK (0 < LENGTH("name")
	AND LENGTH("name") IS NOT NULL)
,	-- It is necessary that each handle of an organization, has a Length (Type) that is greater than 0.
	ADD CONSTRAINT "organization$/jm+9cFLOktW7UDAih9SkCWgaZxrnJBTAFjsx8Lrc7A=" CHECK (0 < LENGTH("handle")
	AND LENGTH("handle") IS NOT NULL)
;

ALTER TABLE "application"
	-- It is necessary that each application has an app name that has a Length (Type) that is greater than or equal to 4 and is less than or equal to 100.
	ADD CONSTRAINT "application$Rlu1vWu2xL/ssYhMPT7xj1zIn00+4AkgpcvOQN9Lr+s=" CHECK (4 <= LENGTH("app name")
	AND LENGTH("app name") <= 100
	AND LENGTH("app name") IS NOT NULL
	AND "app name" IS NOT NULL)
,	-- It is necessary that each application has a uuid that has a Length (Type) that is equal to 32.
	ADD CONSTRAINT "application$GZ8FNlwwxFjgC1YvG6LoHCW/ECfWTpQLmNYKUJQoSXI=" CHECK (LENGTH("uuid") = 32
	AND LENGTH("uuid") IS NOT NULL
	AND "uuid" IS NOT NULL)
;

ALTER TABLE "image"
	-- It is necessary that each image that has a status that is equal to "success", has a push timestamp.
	ADD CONSTRAINT "image$EsnlFqzUfM0jeomVNVuB+GgghnPSgJlMCa0zMBA6cV8=" CHECK (NOT (
		"status" = 'success'
		AND "status" IS NOT NULL
		AND "push timestamp" IS NULL
	))
;

DROP INDEX IF EXISTS "image_status_push_timestamp_idx";
