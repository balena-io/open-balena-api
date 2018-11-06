import * as express from 'express';
import * as Promise from 'bluebird';

export function execute(_app: express.Application, args: string[]) {
	// grab your args as an array, like so...
	const [arg1] = args;

	return Promise.try(() => {
		console.log(`Hello, ${arg1}`);
	});
}
