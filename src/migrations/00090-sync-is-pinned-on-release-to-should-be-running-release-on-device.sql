UPDATE "device" AS "dev"
SET
  "is pinned on-release" = "should be running-release"
WHERE NOT (
  (
      ("dev"."should be running-release") IS NOT NULL
      AND ("dev"."is pinned on-release") IS NOT NULL
      AND ("dev"."should be running-release") = ("dev"."is pinned on-release")
  )
  OR (
      ("dev"."should be running-release") IS NULL AND ("dev"."is pinned on-release") IS NULL
  )
);
