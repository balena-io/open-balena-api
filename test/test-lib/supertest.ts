import { Express } from 'express';
import { Server } from 'http';
import * as $supertest from 'supertest';
import { User } from '../../src/infra/auth/jwt-passport';
import { postInit, preInit } from './init-tests';
import { PineTest } from 'pinejs-client-supertest';

import { redis } from '../../src/infra/redis';

import { sbvrUtils } from '@balena/pinejs';

import defaultConfig = require('./../../config');

export type { PineTest };

export type UserObjectParam = Partial<User & { token: string }>;

export let app: Express;
export let server: Server;
export let version: string;
export let pineTest: PineTest;

before(async function () {
	await initSupertest();
});

export const initSupertest = async function (params?: {
	initConfig?: any;
	deleteDatabase?: boolean;
	flushCache?: boolean;
}) {
	await deInitSupertest(params?.deleteDatabase, params?.flushCache);
	const init = require('./../../init');
	version = init.EXPOSED_API_VERSION;
	app = init.app;
	await preInit();
	server = await init.init(params?.initConfig || defaultConfig);
	await postInit();
	pineTest = new PineTest({ apiPrefix: `${version}/` }, { app });
	return server;
};

// TODO: Why calling this in mocha.after is not cleaning up before calling next before?
export const deInitSupertest = async function (
	deleteDatabase: boolean = true,
	flushCache: boolean = false,
) {
	if (server) {
		await new Promise(async (resolve) => {
			server?.close(() => {
				console.log(`Supertest init server closed`);
				resolve(null);
			});
		});
	}
	if (deleteDatabase) {
		await dropDatabaseSchema();
	}
	if (flushCache) {
		await flushRedisCache();
	}
};

export const supertest = function (user?: string | UserObjectParam) {
	// Can be an object with `token`, a JWT string or an API key string
	let token = user;
	if (typeof user === 'object' && user.token) {
		token = user.token;
	}
	// We have to cast `as any` because the types are poorly maintained
	// and don't support setting defaults
	const req: any = $supertest.agent(app);
	req.set('X-Forwarded-Proto', 'https');

	if (typeof token === 'string') {
		req.set('Authorization', `Bearer ${token}`);
	}
	return req as ReturnType<typeof $supertest.agent>;
};

const dropDatabaseSchema = async (): Promise<void> => {
	if (sbvrUtils.db) {
		await sbvrUtils.db.transaction(async (tx) => {
			try {
				await tx.executeSql(
					`
DROP SCHEMA \"public\" CASCADE; CREATE SCHEMA \"public\";`,
				);
			} catch (err) {
				// ingore all, we don't really care
				console.error(`dropDatabaseSchema error : ${err}`);
			}
		});
	} else {
		// ignore it, most likely the db instance is not yet initialized
	}
};

const flushRedisCache = async (): Promise<void> => {
	try {
		const result = await redis.flushdb('sync');
		console.log(`flushRedisCache result: ${result}`);
	} catch (err) {
		console.log(`flushRedisCache err: ${err}`);
	}
};
