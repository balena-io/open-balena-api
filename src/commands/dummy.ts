import type { Application } from 'express';

export function execute(_app: Application, args: string[]) {
	// grab your args as an array, like so...
	const [arg1] = args;

	console.log(`Hello, ${arg1}`);
}
