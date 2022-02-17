export = {
	fn: async (tx: any) => {
		const staticSql = `\
UPDATE "test"
SET "columnC" = "test"."columnA"
WHERE id IN (   SELECT id FROM (
                    SELECT id FROM "test"
                    WHERE  "test"."columnA" <> "test"."columnC" OR "test"."columnC" IS NULL
                    LIMIT 1

                    ) tmp
            );
        `;

		return await tx.executeSql(staticSql);
	},
	delayMS: 250,
	backoffDelayMS: 4000,
	errorThreshold: 15,
};
