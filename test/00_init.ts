/// <reference path="./typings/supertest-extension.ts" />

import Bluebird from 'bluebird';
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

Bluebird.resolve(fs.promises.readdir(new URL('.', import.meta.url)))
	.call('sort')
	.each(async (fileName) => {
		const ext = path.extname(fileName);
		if (ext !== '.ts') {
			return;
		}
		fileName = path.basename(fileName, ext);
		if (
			testFiles.length > 0 &&
			!testFiles.some((testFile) => testFile(fileName))
		) {
			return;
		}
		const prefix = fileName.split('_', 1)[0];
		if (prefixes[prefix]) {
			throw new Error(`Prefix ${prefix} has already been used`);
		}
		prefixes[prefix] = true;
		if (prefix === '00') {
			// Don't double load this file
			return;
		}
		const { default: initFn } = await import(`./${fileName}.js`);
		describe(fileName, () => {
			initFn();
		});
	})
	.then(() => fs.promises.readdir(new URL('scenarios/', import.meta.url)))
	.each(async (fileName) => {
		const ext = path.extname(fileName);
		if (ext !== '.ts') {
			return;
		}
		fileName = path.basename(fileName, ext);

		if (
			testFiles.length > 0 &&
			!testFiles.some((testFile) => testFile(fileName))
		) {
			return;
		}

		const { default: initFn } = await import(`./scenarios/${fileName}.js`);
		describe(`Scenario: ${fileName}`, () => {
			initFn();
		});
	})
	.done(run);
