/**
 * Creates an actor for each organization that has none.
 */
const backfill = (limit: string) => `\
	WITH "batch" AS (
		SELECT "id", nextval(pg_get_serial_sequence('actor', 'id')) AS "actor"
		FROM "organization"
		WHERE "actor" IS NULL
		${limit}
		FOR UPDATE SKIP LOCKED
	), "inserted" AS (
		INSERT INTO "actor" ("id")
		SELECT "actor" FROM "batch"
	)
	UPDATE "organization" AS o
	SET "actor" = "batch"."actor"
	FROM "batch"
	WHERE o."id" = "batch"."id";
`;

export default {
	asyncSql: backfill('LIMIT %%ASYNC_BATCH_SIZE%%'),
	syncSql: backfill(''),
	delayMS: 1000,
	backoffDelayMS: 60000,
	asyncBatchSize: 1000,
};
