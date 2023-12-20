-- Create a service install for every device + hostApp release service pair
INSERT INTO "service install" ("device", "installs-service")
SELECT d."id", i."is a build of-service"
FROM "device" d
JOIN "release" r ON r."id" = d."should be operated by-release"
JOIN "image-is part of-release" ipr ON ipr."is part of-release" = r."id"
JOIN "image" i ON i."id" = ipr."image"
WHERE d."should be operated by-release" IS NOT NULL
AND NOT EXISTS (
	SELECT 1
	FROM "service install" si
	WHERE si."device" = d."id"
	AND si."installs-service" = i."is a build of-service"
);
