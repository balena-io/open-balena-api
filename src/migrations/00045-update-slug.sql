UPDATE "application"
SET "slug" = LOWER("organization"."handle" || '/' || "application"."app name")
FROM "organization"
WHERE "application"."organization" = "organization"."id";
