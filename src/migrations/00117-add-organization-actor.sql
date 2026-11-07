-- Organizations get an actor, so organization api keys can be `is of-actor` the organization.
-- Nullable until 00118 has converged, after which a later migration can make it NOT NULL.
ALTER TABLE "organization"
ADD COLUMN IF NOT EXISTS "actor" INTEGER NULL;

DO $$
BEGIN
IF NOT EXISTS(
	SELECT 1
	FROM "information_schema"."table_constraints"
	WHERE "table_name" = 'organization'
	AND "constraint_name" = 'organization_actor_fkey'
) THEN
	ALTER TABLE "organization"
	ADD CONSTRAINT "organization_actor_fkey"
	FOREIGN KEY ("actor") REFERENCES "actor" ("id");
END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "organization_actor_key"
ON "organization" ("actor");
