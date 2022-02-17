export = {
	fn: async (tx: any) => {
		const staticSql = `\
UPDATE "testmassive"
SET "columnC" = "testmassive"."columnA"
WHERE id IN (   SELECT id FROM (
                    SELECT id FROM "testmassive"
                    WHERE  "testmassive"."columnA" <> "testmassive"."columnC" OR "testmassive"."columnC" IS NULL
                    LIMIT 10000
                    ) tmp
            );
        `;

		return await tx.executeSql(staticSql);
	},
	delayMS: 500,
	backoffDelayMS: 4000,
	errorThreshold: 15,
};
