export = {
	fn: async (tx: any) => {
		const staticSql = `\
UPDATE "test"
SET "columnC" = "test"."columnA",
	"id" = 1
WHERE id IN (   SELECT id FROM (
                    SELECT id FROM "test"
                    WHERE  "id" = 2
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
