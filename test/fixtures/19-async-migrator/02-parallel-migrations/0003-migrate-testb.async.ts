export = {
	fn: async (tx: any) => {
		const staticSql = `\
UPDATE "testb"
SET "columnC" = "testb"."columnA"
WHERE id IN (   SELECT id FROM (
                    SELECT id FROM "testb"
                    WHERE  "testb"."columnA" <> "testb"."columnC" OR "testb"."columnC" IS NULL
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
