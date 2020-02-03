import { sbvrUtils } from '@resin/pinejs';
import * as _ from 'lodash';

const RESERVED_NAMESPACES = ['io.resin.', 'io.balena.'];

export const checkTagKeyValidity = (key: string) => {
	if (_.isEmpty(key)) {
		throw new sbvrUtils.BadRequestError('Tag key cannot be empty.');
	}
	if (/\s/.test(key)) {
		throw new sbvrUtils.BadRequestError('Tag keys cannot contain whitespace.');
	}
	RESERVED_NAMESPACES.forEach(ns => {
		if (key.startsWith(ns)) {
			throw new sbvrUtils.BadRequestError(
				`Tag keys beginning with ${ns} are reserved.`,
			);
		}
	});
};
