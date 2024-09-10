import type supertest from 'supertest';

// Augment supertest
declare module 'supertest' {
	interface Test {
		_assertStatus(status: number, res: supertest.Response): Error | undefined;
	}
}
