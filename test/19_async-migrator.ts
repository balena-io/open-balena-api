import { initSupertest } from './test-lib/supertest';
import * as _ from 'lodash';
import { sbvrUtils, dbModule } from '@balena/pinejs';
import { assert, expect } from 'chai';
import * as fs from 'fs';
import { setTimeout as delay } from 'timers/promises';

// local test libs:

const fixturesFolder = __dirname + '/fixtures/19-async-migrator/';

const getAllRowsEqualCols = async function (
	tableName: string,
): Promise<dbModule.Result> {
	let result: dbModule.Result = {} as dbModule.Result;
	await sbvrUtils.db.transaction(async (tx) => {
		result = await tx.executeSql(
			`	SELECT * FROM ${tableName}
			WHERE  "columnA" = "columnC" AND "columnC" IS NOT NULL;`,
		);
	});
	return result;
};

const waitForAllDataMigrated = async function (
	tableName: string,
): Promise<[dbModule.Result, dbModule.Result]> {
	let result: dbModule.Result = {} as dbModule.Result;
	let allResults: dbModule.Result = {} as dbModule.Result;
	do {
		result = await getAllRowsEqualCols(tableName);

		await sbvrUtils.db.transaction(async (tx) => {
			allResults = await tx.executeSql(
				`	SELECT * FROM ${tableName}
					ORDER BY id;`,
			);
		});
	} while (result?.rowsAffected !== allResults?.rowsAffected);

	expect(result?.rows.sort((a, b) => a.id - b.id)).to.eql(
		allResults?.rows.sort((a, b) => a.id - b.id),
	);

	return [result, allResults];
};

const getMigrationStatus = async function (): Promise<dbModule.Result> {
	let result: dbModule.Result = {} as dbModule.Result;
	try {
		await sbvrUtils.db.transaction(async (tx) => {
			result = await tx.executeSql(`SELECT * FROM "migration status";`);
		});
	} catch (err) {
		console.log(`test getMigrationStatus: ${err}`);
	}
	return result;
};

const initTestTableData = async function (query: string) {
	await sbvrUtils.db.transaction(async (tx) => {
		try {
			await tx.executeSql(query);
		} catch (err) {
			console.log(`err: ${err}`);
		}
	});
};

const updateOneTableRow = async function (
	tableName: string,
	columnName: string = 'columnC',
) {
	await sbvrUtils.db.transaction(async (tx) => {
		await tx.executeSql(
			`	UPDATE "${tableName}"
				SET "${columnName}" = 'newData'
				WHERE id IN ( 	SELECT id FROM "${tableName}"
								LIMIT 1);`,
		);
	});
};

const stopAllAsyncMigrations = async function () {
	await sbvrUtils.db.transaction(async (tx) => {
		await tx.executeSql(
			`	UPDATE "migration status"
				SET "should stop" = 1;`,
		);
	});

	const sortedRows = (await getMigrationStatus())?.rows.sort(
		(a, b) => a['backoffDelayMS'] - b['backoffDelayMS'],
	);
	await delay(sortedRows.pop()?.['backoffDelayMS'] * 2); // wait until longest backoff time has passed for all migrations to continue.
};

describe('Async Migrations', async function () {
	this.timeout(20000);

	describe('standard async migrations', function () {
		before(async function () {
			const testConfig = require('../config');

			testConfig.models[0].migrationsPath = fixturesFolder + '01-migrations/';

			// delete cached migrations
			testConfig.models[0].migrations = {};
			await initSupertest({ initConfig: testConfig, deleteDatabase: true });

			// manually calling the init data creation sql query as the model gets
			// executed for the first time and sync migrations are skipped
			const initDataSql = await fs.promises.readFile(
				testConfig.models[0].migrationsPath + '0001-init-data.sync.sql',
				'utf8',
			);

			await initTestTableData(initDataSql);
		});

		after(async function () {
			await stopAllAsyncMigrations();
		});

		it('should run one async migrator', async function () {
			let result: dbModule.Result = {} as dbModule.Result;
			// active wait until 1 row has been migrated
			do {
				result = await getMigrationStatus();
			} while (result?.rows[0]?.['migrated rows'] < 1);

			result = await getAllRowsEqualCols('test');
			expect(result?.rows).to.be.not.empty;
		});

		it('should complete / catch up data in one async migrator', async function () {
			let result: dbModule.Result = {} as dbModule.Result;
			// active wait to check if migrations have catched up
			await waitForAllDataMigrated('test');

			result = await getMigrationStatus();

			expect(result?.rows[0]?.['migrated rows']).to.equal(12);
			// expect(result?.rows[])
		});

		it('should migrate future data change after first catch up', async function () {
			let result: dbModule.Result = {} as dbModule.Result;

			const startTime = Date.now().valueOf();
			// first catch up is precondition from above test case.
			do {
				result = await getMigrationStatus();
			} while (result?.rows[0]?.['is backoff'] === 0);
			const firstRowsMigrated = result?.rows[0]?.['migrated rows'];

			expect(firstRowsMigrated).to.be.greaterThan(0);

			await updateOneTableRow('test');

			await waitForAllDataMigrated('test');

			do {
				// first catch up is precondition from above test case.
				result = await getMigrationStatus();
			} while (result?.rows[0]?.['migrated rows'] <= firstRowsMigrated);

			expect(result?.rows[0]?.['migrated rows']).to.be.greaterThan(0);
			expect(result?.rows[0]?.['migrated rows'] - firstRowsMigrated).to.equal(
				1,
			);
			expect(Date.now().valueOf() - startTime).to.be.greaterThan(4000); // backOff time from migrator
		});
	});

	describe('parallel async migrations', function () {
		before(async function () {
			const testConfig = require('../config');

			testConfig.models[0].migrationsPath =
				fixturesFolder + '02-parallel-migrations/';

			// delete cached migrations
			testConfig.models[0].migrations = {};
			await initSupertest({ initConfig: testConfig, deleteDatabase: true });

			// manually calling the init data creation sql query as the model gets
			// executed for the first time and sync migrations are skipped
			const initDataSql = await fs.promises.readFile(
				testConfig.models[0].migrationsPath + '0001-init-data.sync.sql',
				'utf8',
			);

			await initTestTableData(initDataSql);
		});

		after(async function () {
			await stopAllAsyncMigrations();
		});

		it('should start 2 migrations competitive', async function () {
			let result: dbModule.Result = {} as dbModule.Result;
			// active wait until 1 row has been migrated
			do {
				result = await getMigrationStatus();
			} while (
				result?.rows[0]?.['migrated rows'] < 1 ||
				result?.rows[1]?.['migrated rows'] < 1
			);

			result = await getAllRowsEqualCols('testa');
			expect(result?.rowsAffected).to.be.greaterThan(0);

			result = await getAllRowsEqualCols('testb');
			expect(result?.rowsAffected).to.be.greaterThan(0);
		});

		it('should complete / catch up all data in 2 migrations competitive', async function () {
			let result: dbModule.Result = {} as dbModule.Result;
			// active wait to check if migrations have catched up
			await waitForAllDataMigrated('testa');
			await waitForAllDataMigrated('testb');

			result = await getMigrationStatus();

			expect(result?.rows).to.be.an('array').of.length(2);
			result?.rows.map((row) => {
				expect(row['migrated rows']).to.equal(12);
			});
		});

		it('should migrate future data change after first catch up in 2 migrators ', async function () {
			let result: dbModule.Result = {} as dbModule.Result;

			const startTime = Date.now().valueOf();
			do {
				result = await getMigrationStatus();
			} while (
				result?.rows[0]?.['is backoff'] === 0 ||
				result?.rows[1]?.['is backoff'] === 0
			);
			const firstRowsMigratedA = result?.rows[0]?.['migrated rows'];
			const firstRowsMigratedB = result?.rows[1]?.['migrated rows'];

			expect(firstRowsMigratedA).to.be.greaterThan(0);
			expect(firstRowsMigratedB).to.be.greaterThan(0);

			await updateOneTableRow('testa');
			await updateOneTableRow('testb');

			await waitForAllDataMigrated('testa');
			await waitForAllDataMigrated('testb');

			do {
				result = await getMigrationStatus();
			} while (
				result?.rows[0]?.['migrated rows'] <= firstRowsMigratedA ||
				result?.rows[1]?.['migrated rows'] <= firstRowsMigratedB
			);

			expect(result?.rows).to.be.an('array').of.length(2);
			result?.rows.map((row) => {
				expect(row['migrated rows']).to.be.greaterThan(0);
				expect(row['migrated rows'] - firstRowsMigratedA).to.equal(1);
			});
			expect(Date.now().valueOf() - startTime).to.be.greaterThan(4000); // backOff time from migrator
		});
	});

	describe('async migration skip', function () {
		let testConfig: any;
		before(async function () {
			testConfig = require('../config');

			testConfig.models[0].migrationsPath = fixturesFolder + '03-skip-async/';

			// delete cached migrations
			testConfig.models[0].migrations = {};
			await initSupertest({ initConfig: testConfig, deleteDatabase: true });

			// manually calling the init data creation sql query as the model gets
			// executed for the first time and sync migrations are skipped
			const initDataSql = await fs.promises.readFile(
				testConfig.models[0].migrationsPath + 'm0001-init-data.sync.sql',
				'utf8',
			);

			await initTestTableData(initDataSql);
		});

		after(async function () {
			await stopAllAsyncMigrations();
		});

		it('should load all sync and async migrations into model', async function () {
			// check if async migrations have been loaded
			expect(testConfig).haveOwnPropertyDescriptor('models');
			expect(testConfig.models[0].migrations).to.include.all.keys(
				'async',
				'sync',
			);
			expect(testConfig.models[0].migrations['async']).to.include.all.keys(
				'm0002',
				'm0003',
				'm0004',
			);
			expect(testConfig.models[0].migrations['sync']).to.include.all.keys(
				'm0001',
				'm0005',
			);
		});

		it('should not run async migrations', async function () {
			// It's meant to be a wait until we can 'surely' assume that the async migrations
			// would have run at least one iteration. Still a magic number is undesired as it's error prone
			await delay(2000); // wait for some migrations to have happened
			let result: dbModule.Result = {} as dbModule.Result;

			result = await getMigrationStatus();
			expect(result?.rows).to.be.empty;
		});
	});

	describe('error handling in async migrations', function () {
		before(async function () {
			const testConfig = require('../config');

			testConfig.models[0].migrationsPath =
				fixturesFolder + '04-migration-errors/';

			// delete cached migrations
			testConfig.models[0].migrations = {};
			await initSupertest({ initConfig: testConfig, deleteDatabase: true });

			// manually calling the init data creation sql query as the model gets
			// executed for the first time and sync migrations are skipped
			const initDataSql = await fs.promises.readFile(
				testConfig.models[0].migrationsPath + '0001-init-data.sync.sql',
				'utf8',
			);

			await initTestTableData(initDataSql);
		});

		after(async function () {
			await stopAllAsyncMigrations();
		});

		it('should report error in error count', async function () {
			let rows: dbModule.Row[] = [] as dbModule.Row[];
			// active wait until 1 row has been migrated
			const errorMigrationKeys = ['0003', '0004'];
			do {
				const result = await getMigrationStatus();
				rows = result?.rows.filter((row) =>
					errorMigrationKeys.includes(row['migration key']),
				);
			} while (
				rows[0]?.['error counter'] < 2 ||
				rows[1]?.['error counter'] < 2
			);

			// it's 2 because the tables in the init SQL statement are generated AFTER the migrators have
			// been initialised. Thus ALL migrations run on 1 error as the tables not exist.
			expect(rows).to.be.an('array').of.length(2);
			rows.map((row) => {
				expect(row['error counter']).to.equal(row['run counter']);
				expect(row['error counter']).to.be.greaterThanOrEqual(2);
			});
		});

		it('should switch to backoff when exceeding error threshold and give error message', async function () {
			let rows: dbModule.Row[] = [] as dbModule.Row[];
			// active wait until 1 row has been migrated
			const errorMigrationKeys = ['0003', '0004'];
			do {
				const result = await getMigrationStatus();
				rows = result?.rows.filter((row) =>
					errorMigrationKeys.includes(row['migration key']),
				);
			} while (rows[0]?.['is backoff'] === 0 || rows[1]?.['is backoff'] === 0);
			// it's 2 because the tables in the init SQL statement are generated AFTER the migrators have
			// been initialised. Thus ALL migrations run on 1 error as the tables not exist.
			expect(rows).to.be.an('array').of.length(2);
			rows.map((row) => {
				expect(row['error counter']).to.equal(row['run counter']);
				expect(row['error counter']).to.be.greaterThanOrEqual(
					row['error threshold'],
				);
				expect(row['is backoff']).to.equal(1);
				expect(row['last error message']).to.be.an('string');
			});
		});

		it('should remain in backoff when exceeding error threshold and give error message', async function () {
			let rows: dbModule.Row[] = [] as dbModule.Row[];
			// active wait until 1 row has been migrated
			const errorMigrationKeys = ['0003', '0004'];
			do {
				const result = await getMigrationStatus();
				rows = result?.rows.filter((row) =>
					errorMigrationKeys.includes(row['migration key']),
				);
			} while (
				rows[0]?.['error counter'] <= rows[0]?.['error threshold'] + 1 ||
				rows[1]?.['error counter'] <= rows[0]?.['error threshold'] + 1
			);

			// it's 2 because the tables in the init SQL statement are generated AFTER the migrators have
			// been initialised. Thus ALL migrations run on 1 error as the tables not exist.
			expect(rows).to.be.an('array').of.length(2);
			rows.map((row) => {
				expect(row['error counter']).to.be.greaterThanOrEqual(
					row['error threshold'],
				);
				expect(row['error counter']).to.equal(row['run counter']);
				expect(row['is backoff']).to.equal(1);
				expect(row['last error message']).to.be.an('string');
			});
		});

		it('should recover from error backoff when no migration error occurs and rows get migrated', async function () {
			let rows: dbModule.Row[] = [] as dbModule.Row[];
			// active wait until 1 row has been migrated
			const errorMigrationKeys = ['0003'];
			do {
				const result = await getMigrationStatus();
				rows = result?.rows.filter((row) =>
					errorMigrationKeys.includes(row['migration key']),
				);
			} while (rows[0]?.['error counter'] <= rows[0]?.['error threshold'] + 1);

			// it's 2 because the tables in the init SQL statement are generated AFTER the migrators have
			// been initialised. Thus ALL migrations run on 1 error as the tables not exist.
			rows.map((row) => {
				expect(row['error counter']).to.be.greaterThanOrEqual(
					row['error threshold'],
				);
				expect(row['error counter']).to.equal(row['run counter']);
				expect(row['is backoff']).to.equal(1);
				expect(row['last error message']).to.be.an('string');
			});

			const createNonExistingTableAgain = `DROP TABLE IF EXISTS "test-not-exists";

			CREATE TABLE IF NOT EXISTS "test-not-exists" (
				"created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
			,	"id" BIGINT NOT NULL PRIMARY KEY
			,	"columnA" VARCHAR(255) NOT NULL UNIQUE
			,	"columnB" VARCHAR(255) NOT NULL
			,	"columnC" VARCHAR(255) NULL
			);
			
			INSERT INTO "test-not-exists" ("id","columnA", "columnB", "columnC")
			VALUES 
			(1,'a001','b001', NULL),
			(2,'a002','b002', NULL);`;

			await initTestTableData(createNonExistingTableAgain);
			// wait for backoff to be released
			do {
				const result = await getMigrationStatus();
				rows = result?.rows.filter((row) =>
					errorMigrationKeys.includes(row['migration key']),
				);
			} while (rows[0]?.['is backoff'] === 1);

			rows.map((row) => {
				expect(row['is backoff']).to.equal(0);
				expect(row['migrated rows']).to.be.greaterThan(0);
			});
		});
	});

	describe('massive data async migrations', function () {
		before(async function () {
			const testConfig = require('../config');

			testConfig.models[0].migrationsPath = fixturesFolder + '05-massive-data/';

			// delete cached migrations
			testConfig.models[0].migrations = {};
			await initSupertest({ initConfig: testConfig, deleteDatabase: true });

			// manually calling the init data creation sql query as the model gets
			// executed for the first time and sync migrations are skipped
			const initDataSql = await fs.promises.readFile(
				testConfig.models[0].migrationsPath + '0001-init-massive-data.sync.sql',
				'utf8',
			);

			await initTestTableData(initDataSql);
		});

		after(async function () {
			await stopAllAsyncMigrations();
		});

		it('should complete / catch up data in one async migrator', async function () {
			let rows: dbModule.Row[] = [] as dbModule.Row[];
			// active wait to check if migrations have catched up
			do {
				const result = await getMigrationStatus();
				rows = result?.rows;

				// just do some database access during waiting for finished migration
				const allPromises = [];
				for (let i = 0; i < 100; i++) {
					allPromises.push(updateOneTableRow('testmassive', 'columnB'));
				}
				try {
					await Promise.all(allPromises);
				} catch (err) {
					assert('Parallel Databaseaccess should not fail');
				}
				delay(100);
			} while (rows === undefined || rows[0]?.['migrated rows'] < 200000);

			expect(rows[0]?.['migrated rows']).to.equal(200000);
		});
	});
});
