import type { Migrator } from '@balena/pinejs';

const migration: Migrator.AsyncMigration = {
	asyncSql: `\
		UPDATE "device service environment variable" AS dsev
		SET
			"device" = si."device",
			"service" = si."installs-service"
		FROM "service install" AS si
		WHERE dsev."service install" = si."id"
		AND dsev.id IN (
			SELECT id
			FROM "device service environment variable"
			WHERE ( "device" IS NULL OR "service" IS NULL )
			FOR UPDATE SKIP LOCKED
			LIMIT %%ASYNC_BATCH_SIZE%%
		);
	`,
	syncSql: `\
		UPDATE "device service environment variable" AS dsev
		SET
			"device" = si."device",
			"service" = si."installs-service"
		FROM "service install" AS si
		WHERE
			dsev."service install" = si."id"
			AND (dsev."device" IS NULL OR dsev."service" IS NULL);
	`,
	asyncBatchSize: 5000,
	delayMS: 60000,
	backoffDelayMS: 120000,
	errorThreshold: 10,
	finalize: true,
};

export default migration;
