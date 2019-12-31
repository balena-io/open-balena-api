import * as express from 'express';

export async function execute(_app: express.Application, args: string[]) {
	// grab your args as an array, like so...
	const [arg1] = args;

	console.log(`Hello, ${arg1}`);
}
