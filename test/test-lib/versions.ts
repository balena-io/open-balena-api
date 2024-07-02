import _ from 'lodash';

export const versions = ['v6', 'v7', 'resin'] as const;

import type { PineTest } from 'pinejs-client-supertest';
import { pineTest } from './pinetest.js';

export type ValidVersion = (typeof versions)[number];

const TEST_VERSIONS = _.chain(process.env.TEST_VERSIONS)
	.trim()
	.thru((testVersions) => {
		if (_.isEmpty(testVersions)) {
			return versions;
		}
		return _.intersection(versions, testVersions.split(' '));
	})
	.value() as ValidVersion[];

export const test = (
	testFn: (version: ValidVersion, pineTest: PineTest) => void,
) => {
	for (const version of TEST_VERSIONS) {
		describe(version, () => {
			testFn(version, pineTest[version]);
		});
	}
};

const getVersionIndex = (v: ValidVersion) => {
	const index = versions.indexOf(v);
	if (index === -1) {
		throw new Error(`Unknown version '${v}'`);
	}
	return index;
};

export const lt = (v1: ValidVersion, v2: ValidVersion) =>
	getVersionIndex(v1) < getVersionIndex(v2);

export const lte = (v1: ValidVersion, v2: ValidVersion) =>
	getVersionIndex(v1) <= getVersionIndex(v2);

export const gt = (v1: ValidVersion, v2: ValidVersion) =>
	getVersionIndex(v1) > getVersionIndex(v2);

export const gte = (v1: ValidVersion, v2: ValidVersion) =>
	getVersionIndex(v1) >= getVersionIndex(v2);

export const max = (v1: ValidVersion, v2: ValidVersion) =>
	versions[Math.max(getVersionIndex(v1), getVersionIndex(v2))];

export const min = (v1: ValidVersion, v2: ValidVersion) =>
	versions[Math.min(getVersionIndex(v1), getVersionIndex(v2))];
