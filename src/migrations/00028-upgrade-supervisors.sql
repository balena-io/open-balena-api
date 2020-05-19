-- Set null supervisor releases to their current "official" versions if they exist

UPDATE "device" d
SET
       "should be managed by-supervisor release" = s."id"
FROM "supervisor release" s
WHERE d."is of-device type" = s."is for-device type" AND
       s."supervisor version" = concat('v', d."supervisor version") AND
       d."should be managed by-supervisor release" IS NULL
;
