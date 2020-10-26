import * as fs from 'fs';
import * as _ from 'lodash';
import * as path from 'path';
import { promisify } from 'util';
import { exec } from 'child_process';
import configJson = require('../config');

const execAsync = promisify(exec);

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

					const fullSqlPaths = fileNames
						.filter((fileName) => fileName.endsWith('.sql'))
						.map((fileName) => path.join(migrationsPath!, fileName));
					try {
						await execAsync(`pgsanity '${fullSqlPaths.join("' '")}'`);
					} catch (e) {
						throw new Error(`Invalid sql in ${e.stdout}`);
					}
				});
			});
		});
});

describe('balena-init.sql', () => {
	it('should have valid sql', async () => {
		try {
			await execAsync(
				`pgsanity '${require.resolve('../src/balena-init.sql')}'`,
			);
		} catch (e) {
			throw new Error(`Invalid sql in ${e.stdout}`);
		}
	});
});
