import 'supertest';

// Augment supertest
declare module 'supertest' {
	interface Test {
		_assertStatus(status: number, res: Response): Error | undefined;
	}
}
