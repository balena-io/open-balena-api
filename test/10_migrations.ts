import { fileURLToPath } from 'node:url';
import { strict as assert } from 'assert';
import fs from 'fs';
import _ from 'lodash';
import { execSync } from 'node:child_process';
import path from 'path';
import configJson from '../config.js';
import type { types } from '@balena/pinejs';
import { assertExists } from './test-lib/common.js';

// Validate SQL files using squawk
function validateSql(file: string): void {
	try {
		execSync(`pgpp -t ${file}`, {
			stdio: ['ignore', 'ignore', 'pipe'],
		});
	} catch (e) {
		throw new Error(`Invalid SQL in ${file}: ${e.stderr.toString()}`);
	}
}

export default () => {
	describe('migrations', () => {
		_(configJson.models)
			.filter(
				(m): m is types.RequiredField<typeof m, 'migrationsPath'> =>
					m.migrationsPath != null,
			)
			.each(({ modelName, migrationsPath }) => {
				assertExists(modelName);
				describe(modelName, () => {
					if (!path.isAbsolute(migrationsPath)) {
						migrationsPath = fileURLToPath(
							new URL('../src/' + migrationsPath, import.meta.url),
						);
					}
					const fileNames = fs.readdirSync(migrationsPath);
					it('should have unique prefixes', () => {
						const duplicates = _(fileNames)
							.groupBy((v) => v.split('-', 1)[0])
							.filter((v) => v.length > 1)
							.value();
						if (duplicates.length > 0) {
							throw new Error(
								`Duplicate prefixes:\n\t${duplicates.join('\n\t')}`,
							);
						}
					});

					// Sanity check SQL files
					for (const fileName of fileNames.filter((f) => {
						return f.endsWith('.sql');
					})) {
						it(`should have valid sql in ${fileName}`, () => {
							validateSql(path.join(migrationsPath, fileName));
						});
					}

					// Sanity check async migrations
					const asyncMigrationPaths = fileNames
						.filter((fileName) => fileName.endsWith('.async.ts'))
						.map((fileName) => path.join(migrationsPath, fileName));
					for (const asyncMigrationPath of asyncMigrationPaths) {
						it(`should have valid sql in ${asyncMigrationPath}`, async () => {
							const migration = (await import(asyncMigrationPath)).default;
							if (migration.syncSql || migration.asyncSql) {
								assert(
									migration.syncSql &&
										migration.asyncSql &&
										migration.asyncBatchSize,
									'Missing required async migration options',
								);
								const asyncPath = `/tmp/async-${path.basename(
									asyncMigrationPath,
								)}.sql`;
								const syncPath = `/tmp/sync-${path.basename(
									asyncMigrationPath,
								)}.sql`;
								fs.writeFileSync(
									asyncPath,
									migration.asyncSql.replaceAll(
										'%%ASYNC_BATCH_SIZE%%',
										migration.asyncBatchSize,
									),
								);
								fs.writeFileSync(syncPath, migration.syncSql);
								validateSql(asyncPath);
								validateSql(syncPath);
								fs.unlinkSync(asyncPath);
								fs.unlinkSync(syncPath);
							}
						});
					}
				});
			});
	});

	describe('balena-init.sql', () => {
		it('should have valid sql', () => {
			validateSql('src/balena-init.sql');
		});
	});
};
