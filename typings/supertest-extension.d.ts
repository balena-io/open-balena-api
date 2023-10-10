import 'supertest';

// Augment supertest
declare module 'supertest' {
	interface Test {
		_assertStatus(status: number, res: Response): Error | undefined;
	}

	function Test(app: any, method: string, path: string): Test;
}
