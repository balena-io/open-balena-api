import * as Bluebird from 'bluebird';
import * as fs from 'fs';
import * as _ from 'lodash';
import * as path from 'path';

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

Bluebird.resolve(fs.promises.readdir(__dirname))
	.call('sort')
	.each((fileName) => {
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
		describe(fileName, () => {
			require(`./${fileName}`);
		});
	})
	.then(() => fs.promises.readdir(path.join(__dirname, 'scenarios')))
	.each((filename) => {
		const ext = path.extname(filename);
		if (ext !== '.ts') {
			return;
		}
		filename = path.basename(filename, ext);

		if (
			testFiles.length > 0 &&
			!testFiles.some((testFile) => testFile(filename))
		) {
			return;
		}

		describe(`Scenario: ${filename}`, () => {
			require(path.join(__dirname, 'scenarios', filename));
		});
	})
	.done(run);
