UPDATE "image install"
SET "download progress" = NULL
WHERE status = 'deleted'
AND "download progress" IS NOT NULL;
