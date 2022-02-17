export = {
	fn: async (tx: any) => {
		const staticSql = `\
UPDATE "test-not-exists"
SET "columnC" = "test-not-exists"."columnA"
WHERE id IN (   SELECT id FROM (
                    SELECT id FROM "test-not-exists"
                    WHERE  "test-not-exists"."columnA" <> "test-not-exists"."columnC" OR "test-not-exists"."columnC" IS NULL
                    LIMIT 1

                    ) tmp
            );
        `;

		return await tx.executeSql(staticSql);
	},
	delayMS: 250,
	backoffDelayMS: 1000,
	errorThreshold: 5,
};
