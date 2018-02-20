import * as _express from 'express';

import { runInTransaction } from '../platform';
import { registerUser } from '../platform/auth';

function usage() {
	return 'create-superuser USERNAME EMAIL PASSWORD';
}

export function execute(_app: _express.Application, args: string[]) {
	const [username, email, password] = args;
	if (username == null || email == null || password == null) {
		throw new Error(usage());
	}
	return runInTransaction(tx =>
		registerUser({ username, email, password }, tx),
	);
}
