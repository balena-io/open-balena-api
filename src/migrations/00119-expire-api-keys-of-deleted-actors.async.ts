import type { Migrator } from '@balena/pinejs';

// Expire the api keys whose actor no longer belongs to a device, application or
// user, ie the keys of devices and applications deleted before their api keys
// started being expired on deletion
const orphanedApiKeysFilter = `\
	("expiry date" IS NULL OR "expiry date" > CURRENT_TIMESTAMP)
	AND NOT EXISTS (
		SELECT 1 FROM "device" WHERE "device"."actor" = "api key"."is of-actor"
	)
	AND NOT EXISTS (
		SELECT 1 FROM "application" WHERE "application"."actor" = "api key"."is of-actor"
	)
	AND NOT EXISTS (
		SELECT 1 FROM "user" WHERE "user"."actor" = "api key"."is of-actor"
	)`;

const migration: Migrator.AsyncMigration = {
	asyncSql: `\
		UPDATE "api key"
		SET "expiry date" = CURRENT_TIMESTAMP
		WHERE "id" IN (
			SELECT "id"
			FROM "api key"
			WHERE ${orphanedApiKeysFilter}
			LIMIT %%ASYNC_BATCH_SIZE%%
			FOR UPDATE SKIP LOCKED
		);
	`,
	syncSql: `\
		UPDATE "api key"
		SET "expiry date" = CURRENT_TIMESTAMP
		WHERE ${orphanedApiKeysFilter};
	`,
	asyncBatchSize: 5000,
	delayMS: 10000,
	// Once converged every run scans all the unexpired api keys, so back off for
	// longer until this gets finalized
	backoffDelayMS: 3600000,
	errorThreshold: 10,
	finalize: false,
};

export default migration;
