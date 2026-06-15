CREATE UNIQUE INDEX IF NOT EXISTS "user_actor_key" ON "user" ("actor");

-- The unique index supersedes the old non-unique lookup index.
DROP INDEX IF EXISTS "user_actor_idx";
