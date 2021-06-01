-- Create a service install for every device + supervisor release service pairing
INSERT INTO "service install" ("device", "installs-service")
SELECT d."id", s."id"
FROM "device" d
JOIN "release" r ON r."id" = d."should be managed by-release"
JOIN "image-is part of-release" ipr ON ipr."is part of-release" = r."id"
JOIN "image" i ON i."id" = ipr."image"
JOIN "service" s ON s.id = i."is a build of-service";
