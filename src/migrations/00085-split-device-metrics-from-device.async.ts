import type { Migrator } from '@balena/pinejs';

const migration: Migrator.AsyncMigration = {
	asyncSql: `\
			INSERT INTO	"device metrics record" (
				"is reported by-device",
				"memory usage",
				"memory total",
				"storage block device",
				"storage usage",
				"storage total",
				"cpu usage",
				"cpu temp",
				"is undervolted"
			)
			SELECT
				"id",
				"memory usage",
				"memory total",
				"storage block device",
				"storage usage",
				"storage total",
				"cpu usage",
				"cpu temp",
				"is undervolted"
			FROM (
				SELECT * FROM "device"
				WHERE
					"device".id NOT IN (
						SELECT
							"is reported by-device"
						FROM
							"device metrics record"
					)
				LIMIT %%ASYNC_BATCH_SIZE%%
				FOR UPDATE SKIP LOCKED
			) AS pending;`,
	syncSql: `\
		INSERT INTO	"device metrics record" (
			"is reported by-device",
			"memory usage",
			"memory total",
			"storage block device",
			"storage usage",
			"storage total",
			"cpu usage",
			"cpu temp",
			"is undervolted"
		)
		SELECT
			"id",
			"memory usage",
			"memory total",
			"storage block device",
			"storage usage",
			"storage total",
			"cpu usage",
			"cpu temp",
			"is undervolted"
		FROM (
			SELECT * FROM "device"
			WHERE
				"device".id NOT IN (
					SELECT
						"is reported by-device"
					FROM
						"device metrics record"
				)
			FOR UPDATE SKIP LOCKED
		) AS pending;`,
	asyncBatchSize: 10000,
	delayMS: 5000,
	backoffDelayMS: 60000,
	errorThreshold: 15,
	finalize: false,
};

export default migration;
