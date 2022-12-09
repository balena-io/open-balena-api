import { strict as assert } from 'assert';
import fs from 'fs';
import _ from 'lodash';
import path from 'path';
import parser from 'libpg-query';
import configJson from '../config';

describe('migrations', () => {
	_(configJson.models)
		.filter('migrationsPath')
		.each(({ modelName, migrationsPath }) => {
			describe(modelName!, () => {
				if (!path.isAbsolute(migrationsPath!)) {
					migrationsPath = __dirname + '/../src/' + migrationsPath;
				}
				const fileNamesPromise = fs.promises.readdir(migrationsPath!);
				it('should have unique prefixes', async () => {
					const fileNames = await fileNamesPromise;

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

				it('should have valid sql', async () => {
					const fileNames = await fileNamesPromise;

					// Sanity check SQL files
					const fullSqlPaths = fileNames
						.filter((fileName) => fileName.endsWith('.sql'))
						.map((fileName) => path.join(migrationsPath!, fileName));
					for (const fullSqlPath of fullSqlPaths) {
						try {
							const sql = await fs.promises.readFile(fullSqlPath, 'utf8');
							await parser.parseQuery(sql);
						} catch (e) {
							const [migrationKey] = path.basename(fullSqlPath).split('-', 1);
							throw new Error(
								`Invalid sql for migration ${migrationKey}: ${e} `,
							);
						}
					}

					// Sanity check async migrations
					const asyncMigrationPaths = fileNames
						.filter((fileName) => fileName.endsWith('.async.ts'))
						.map((fileName) => path.join(migrationsPath!, fileName));
					for (const asyncMigrationPath of asyncMigrationPaths) {
						const migration = (await import(asyncMigrationPath)).default;
						if (migration.syncSql || migration.asyncSql) {
							assert(
								migration.syncSql &&
									migration.asyncSql &&
									migration.asyncBatchSize,
								'Missing required async migration options',
							);
							try {
								await parser.parseQuery(
									migration.asyncSql.replaceAll(
										'%%ASYNC_BATCH_SIZE%%',
										migration.asyncBatchSize,
									),
								);
								await parser.parseQuery(migration.syncSql);
							} catch (e) {
								const [migrationKey] = path
									.basename(asyncMigrationPath)
									.split('-', 1);
								throw new Error(
									`Invalid sql for migration ${migrationKey}: ${e} `,
								);
							}
						}
					}
				});
			});
		});
});

describe('balena-init.sql', () => {
	it('should have valid sql', async () => {
		try {
			const sql = await fs.promises.readFile(
				require.resolve('../src/balena-init.sql'),
				'utf8',
			);
			await parser.parseQuery(sql);
		} catch (e) {
			throw new Error(`Invalid sql: ${e} `);
		}
	});
});
