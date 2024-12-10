/// <reference path="./typings/supertest-extension.ts" />

import fs from 'fs';
import _ from 'lodash';
import path from 'path';

const testFiles = _(process.env.TEST_FILES)
	.trim()
	.split(' ')
	.map((fileName): ((f: string) => boolean) => {
		const [op, ...rest] = fileName;
		const compareFilename = rest.join('');
		switch (op) {
			case '<':
				return (f) => f < compareFilename;
			case '>':
				return (f) => f > compareFilename;
			default:
				return (f) => f.startsWith(fileName);
		}
	});

const prefixes: Dictionary<true> = {};

try {
	for (let fileName of (
		await fs.promises.readdir(new URL('.', import.meta.url))
	).sort()) {
		const ext = path.extname(fileName);
		if (ext !== '.ts') {
			continue;
		}
		fileName = path.basename(fileName, ext);
		if (
			testFiles.length > 0 &&
			!testFiles.some((testFile) => testFile(fileName))
		) {
			continue;
		}
		const prefix = fileName.split('_', 1)[0];
		if (prefixes[prefix]) {
			throw new Error(`Prefix ${prefix} has already been used`);
		}
		prefixes[prefix] = true;
		if (prefix === '00') {
			// Don't double load this file
			continue;
		}
		const { default: initFn } = await import(`./${fileName}.js`);
		describe(fileName, () => {
			initFn();
		});
	}
	for (let fileName of await fs.promises.readdir(
		new URL('scenarios/', import.meta.url),
	)) {
		const ext = path.extname(fileName);
		if (ext !== '.ts') {
			continue;
		}
		fileName = path.basename(fileName, ext);

		if (
			testFiles.length > 0 &&
			!testFiles.some((testFile) => testFile(fileName))
		) {
			continue;
		}

		const { default: initFn } = await import(`./scenarios/${fileName}.js`);
		describe(`Scenario: ${fileName}`, () => {
			initFn();
		});
	}
} finally {
	run();
}
