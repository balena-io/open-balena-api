import * as _platform from '../../src/platform';
import * as _permissions from '../../src/platform/permissions';

export = () => {
	const platform: typeof _platform = require('../../src/platform');
	const permissions: typeof _permissions = require('../../src/platform/permissions');

	return {
		platform,
		permissions,
	};
};
