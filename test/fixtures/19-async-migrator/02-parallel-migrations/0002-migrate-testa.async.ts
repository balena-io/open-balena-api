export = {
	fn: async (tx: any) => {
		const staticSql = `\
UPDATE "testa"
SET "columnC" = "testa"."columnA"
WHERE id IN (   SELECT id FROM (
                    SELECT id FROM "testa"
                    WHERE  "testa"."columnA" <> "testa"."columnC" OR "testa"."columnC" IS NULL
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
