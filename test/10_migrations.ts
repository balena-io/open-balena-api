import { fileURLToPath } from 'node:url';
import { strict as assert } from 'assert';
import fs from 'fs';
import _ from 'lodash';
import { spawn } from 'node:child_process';
import path from 'path';
import configJson from '../config.js';
import type { Migrator } from '@balena/pinejs';
import { assertExists } from './test-lib/common.js';
import { fakeSbvrUtils } from './test-lib/fixtures.js';
import { expect } from 'chai';

// Validate SQL files using squawk
async function validateSql(file: string): Promise<void> {
	let stderr = '';
	try {
		await new Promise<void>((resolve, reject) => {
			spawn('pgpp', ['-t', file], {
				stdio: ['ignore', 'ignore', 'pipe'],
			})
				.on('error', reject)
				.on('exit', (code) => {
					if (code === 0) {
						resolve();
					} else {
						reject(new Error(`Received exit code '${code}'`));
					}
				})
				.stderr.on('data', (data) => {
					stderr += data.toString();
				});
		});
	} catch {
		throw new Error(`Invalid SQL in ${file}: ${stderr}`);
	}
}

const hasExactlyOneOfMigration = (
	sqlPart: string | undefined,
	fnPart: Migrator.AsyncMigrationFn | Migrator.MigrationFn | undefined,
) => (typeof sqlPart === 'string') !== (typeof fnPart === 'function');

const getTxSpy = () => {
	const sqlRun: string[] = [];
	// eslint-disable-next-line @typescript-eslint/require-await -- We need to return a promise for mocking reasons but we don't need to await.
	const executeSql = async (sql: string) => {
		sqlRun.push(sql);
		return {
			rowsAffected: 1,
		};
	};
	return {
		getSqlRun() {
			return sqlRun.length > 0 ? sqlRun.join('\n') : null;
		},
		fakeTx: {
			executeSql,
		} as Tx,
	};
};

export default () => {
	describe('migrations', () => {
		for (const model of configJson.models) {
			if (!('migrationsPath' in model) || model.migrationsPath == null) {
				continue;
			}
			describe(model.modelName!, () => {
				let { migrationsPath } = model;
				if (!path.isAbsolute(migrationsPath!)) {
					migrationsPath = fileURLToPath(
						new URL('../src/' + migrationsPath, import.meta.url),
					);
				}
				const fileNames = fs.readdirSync(migrationsPath!);
				it('should have unique prefixes', () => {
					const mapFileNames = fileNames.filter(
						(filename) => !filename.endsWith('.js.map'),
					);

					const duplicates = _(mapFileNames)
						.groupBy((v) => v.split('-', 1)[0])
						.filter((v) => v.length > 1)
						.value();
					if (duplicates.length > 0) {
						throw new Error(
							`Duplicate prefixes:\n\t${duplicates.join('\n\t')}`,
						);
					}
				});

				// Starts with 5-digits or the accidental [0067-0077] that we already have.
				// Has a name with letters digits dashes and underscores.
				// Ends with .sql | .ts | .sync.sql | .async.ts (and has no other dots before that).
				const MIGRATION_FILENAME_REGEX =
					/^((\d{5})|(006[7-9]|007[0-7]))-([\w\d-]+)(((\.sync)?\.sql)|((\.async)?\.ts))$/;

				// Sanity check SQL files
				for (const fileName of fileNames.filter((f) => {
					return f.endsWith('.sql');
				})) {
					it(`should have valid sql in ${fileName}`, async () => {
						await validateSql(path.join(migrationsPath!, fileName));
					});

					it(`should have valid filename: ${fileName}`, () => {
						expect(fileName).to.match(MIGRATION_FILENAME_REGEX);
					});
				}

				// Sanity check async migrations
				const asyncMigrationPaths = fileNames
					.filter((fileName) => fileName.match(/\.async\.(ts|js)$/) != null)
					.map((fileName) => path.join(migrationsPath!, fileName));
				for (const asyncMigrationPath of asyncMigrationPaths) {
					it(`should have valid sql in ${asyncMigrationPath}`, async () => {
						const migration = (await import(asyncMigrationPath))
							.default as Migrator.AsyncMigration;
						if (migration.syncSql != null || migration.asyncSql != null) {
							assert(
								hasExactlyOneOfMigration(migration.syncSql, migration.syncFn) &&
									hasExactlyOneOfMigration(
										migration.asyncSql,
										migration.asyncFn,
									),
								'Missing required async migration options',
							);
							const { asyncBatchSize } = migration;
							assertExists(asyncBatchSize, 'Missing required asyncBatchSize');

							const asyncSql =
								migration.asyncSql?.replaceAll(
									'%%ASYNC_BATCH_SIZE%%',
									asyncBatchSize.toString(),
								) ??
								(await (async () => {
									const txSpy = getTxSpy();
									await migration.asyncFn?.(
										txSpy.fakeTx,
										{ batchSize: asyncBatchSize },
										fakeSbvrUtils,
									);
									return txSpy.getSqlRun();
								})());
							assertExists(
								asyncSql,
								'async parts of migration did not resolve to a string',
							);
							expect(asyncSql).to.be.a(
								'string',
								'async parts of migration did not resolve to a string',
							);

							const syncSql =
								migration.syncSql ??
								(await (async () => {
									const txSpy = getTxSpy();
									await migration.syncFn?.(txSpy.fakeTx, fakeSbvrUtils);
									return txSpy.getSqlRun();
								})());
							assertExists(
								syncSql,
								'sync parts of migration did not resolve to a string',
							);
							expect(syncSql).to.be.a(
								'string',
								'sync parts of migration did not resolve to a string',
							);

							const asyncPath = `/tmp/async-${path.basename(
								asyncMigrationPath,
							)}.sql`;
							const syncPath = `/tmp/sync-${path.basename(
								asyncMigrationPath,
							)}.sql`;
							fs.writeFileSync(asyncPath, asyncSql);
							fs.writeFileSync(syncPath, syncSql);
							await validateSql(asyncPath);
							await validateSql(syncPath);
							fs.unlinkSync(asyncPath);
							fs.unlinkSync(syncPath);
						}
					});
				}
			});
		}
	});

	describe('balena-init.sql', () => {
		it('should have valid sql', async () => {
			await validateSql('src/balena-init.sql');
		});
	});
};
