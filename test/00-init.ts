import * as Promise from 'bluebird';
import * as _ from 'lodash';
import * as fs from 'fs';
import * as path from 'path';

import { app } from '../init';
import supertest = require('./test-lib/supertest');

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

before(async () => {
	await supertest(app)
		.get('/device-types/v1')
		.expect(200);
});

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
	.done(run);
