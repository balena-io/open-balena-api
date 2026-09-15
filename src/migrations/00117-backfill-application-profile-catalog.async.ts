import type { Migrator } from '@balena/pinejs';

const migration: Migrator.AsyncMigration = {
	asyncSql: `\
		WITH candidate_apps AS (
			SELECT DISTINCT r."belongs to-application" AS application_id
			FROM "release" r
			WHERE r.status = 'success'
			AND EXISTS (
				SELECT 1 FROM "image-is part of-release" ri
				JOIN "image profile" ip ON ip."release image" = ri.id
				WHERE ri."is part of-release" = r.id
			)
			AND NOT EXISTS (
				SELECT 1 FROM "application profile catalog" apc
				WHERE apc."application" = r."belongs to-application"
			)
			LIMIT %%ASYNC_BATCH_SIZE%%
		)
		INSERT INTO "application profile catalog" ("application", "catalogs-profile name")
		SELECT DISTINCT r."belongs to-application", ip."profile name"
		FROM candidate_apps ca
		JOIN "release" r ON r."belongs to-application" = ca.application_id
		JOIN "image-is part of-release" ri ON ri."is part of-release" = r.id
		JOIN "image profile" ip ON ip."release image" = ri.id
		WHERE r.status = 'success'
		ON CONFLICT ("application", "catalogs-profile name") DO NOTHING;
	`,
	syncSql: `\
		INSERT INTO "application profile catalog" ("application", "catalogs-profile name")
		SELECT DISTINCT r."belongs to-application", ip."profile name"
		FROM "release" r
		JOIN "image-is part of-release" ri ON ri."is part of-release" = r.id
		JOIN "image profile" ip ON ip."release image" = ri.id
		WHERE r.status = 'success'
		ON CONFLICT ("application", "catalogs-profile name") DO NOTHING;
	`,
	asyncBatchSize: 1000,
	delayMS: 60000,
	backoffDelayMS: 120000,
	errorThreshold: 10,
	finalize: true,
};

export default migration;
