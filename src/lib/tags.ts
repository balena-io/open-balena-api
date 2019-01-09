import * as _ from 'lodash';

const RESERVED_NAMESPACES = ['io.resin.', 'io.balena.'];

export const checkTagKeyValidity = (key: string) => {
	if (_.isEmpty(key)) {
		throw new Error('Tag key cannot be empty.');
	}
	if (/\s/.test(key)) {
		throw new Error('Tag keys cannot contain whitespace.');
	}
	RESERVED_NAMESPACES.forEach(ns => {
		if (_.startsWith(key, ns)) {
			throw new Error(`Tag keys beginning with ${ns} are reserved.`);
		}
	});
};
