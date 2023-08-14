import { strict as assert } from 'assert';
import fs from 'fs';
import _ from 'lodash';
import { execSync } from 'node:child_process';
import path from 'path';
import configJson from '../config';

// Validate SQL files using squawk
function validateSql(files: string[]): void {
	try {
		execSync(
			`npx squawk --pg-version=15.0 --dump-ast parsed ${files.join(' ')}`,
			{
				stdio: ['ignore', 'ignore', 'pipe'],
			},
		);
	} catch (e) {
		throw new Error(`Invalid SQL: ${e.stderr.toString()}`);
	}
}

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
					validateSql([`${migrationsPath}/*.sql`]);

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
								validateSql([asyncPath, syncPath]);
								fs.unlinkSync(asyncPath);
								fs.unlinkSync(syncPath);
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
		validateSql(['src/balena-init.sql']);
	});
});
