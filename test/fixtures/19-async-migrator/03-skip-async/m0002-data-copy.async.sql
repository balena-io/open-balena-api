UPDATE "test"
SET "columnC" = "test"."columnA"
WHERE id IN (   SELECT id FROM (
                    SELECT id FROM "test"
                    WHERE  "test"."columnA" <> "test"."columnC" OR "test"."columnC" IS NULL
                    LIMIT 1

                    ) tmp
			);
