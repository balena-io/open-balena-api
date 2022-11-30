/**
 * Update "release"."contract" fields with text that has been stringified
 * multiple times to contain text that has only been stringified once.
 */
export = {
	asyncSql: `\
	UPDATE "release" SET "contract" = "release"."contract"::jsonb#>>'{}' WHERE id IN (
		SELECT id FROM "release" WHERE STARTS_WITH("contract", '"') LIMIT %%ASYNC_BATCH_SIZE%% FOR UPDATE SKIP LOCKED
	);
	`,
	syncSql: `\
	UPDATE "release" SET "contract" = "release"."contract"::jsonb#>>'{}' WHERE id IN (
		SELECT "id" FROM "release" WHERE STARTS_WITH("contract", '"')
	);
	`,
	delayMS: 10000,
	backoffDelayMS: 4000,
	errorThreshold: 15,
	asyncBatchSize: 1000,
	finalize: true,
};
