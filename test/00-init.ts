import * as Promise from 'bluebird';
import * as _ from 'lodash';
import * as fs from 'fs';
import * as path from 'path';

import { deviceTypes } from '../src/lib/device-types';
import { sbvrUtils } from '@resin/pinejs';

before('Pre-Run Things', async () => {
	// this will wait on the pre-fetch the device types and populate the cache...
	await deviceTypes(sbvrUtils.api.resin);
});

const testFiles = _(process.env.TEST_FILES)
	.trim()
	.split(' ')
	.map((fileName): ((f: string) => boolean) => {
		const [op, ...rest] = fileName;
		const compareFilename = rest.join('');
		switch (op) {
			case '<':
				return f => f < compareFilename;
			case '>':
				return f => f > compareFilename;
			default:
				return f => f.startsWith(fileName);
		}
	});

const prefixes: Dictionary<true> = {};

Promise.resolve(fs.promises.readdir(__dirname))
	.call('sort')
	.each(fileName => {
		const ext = path.extname(fileName);
		if (ext !== '.ts') {
			return;
		}
		fileName = path.basename(fileName, ext);
		if (
			testFiles.length > 0 &&
			!_.some(testFiles, testFile => testFile(fileName))
		) {
			return;
		}
		const prefix = fileName.split('_')[0];
		if (prefixes[prefix]) {
			throw new Error(`Prefix ${prefix} has already been used`);
		}
		prefixes[prefix] = true;
		describe(fileName, () => {
			require(`./${fileName}`);
		});
	})
	.then(() => fs.promises.readdir(path.join(__dirname, 'scenarios')))
	.each(filename => {
		const ext = path.extname(filename);
		if (ext !== '.ts') {
			return;
		}
		filename = path.basename(filename, ext);

		if (
			testFiles.length > 0 &&
			!_.some(testFiles, testFile => testFile(filename))
		) {
			return;
		}

		describe(`Scenario: ${filename}`, () => {
			require(path.join(__dirname, 'scenarios', filename));
		});
	})
	.done(run);
