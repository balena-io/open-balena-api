import _ from 'lodash';

import { hooks } from '@balena/pinejs';

const releaseUpdateTimestampHook: hooks.Hooks = {
	POSTPARSE: ({ request }) => {
		request.values.update_timestamp = Date.now();
	},
};

hooks.addPureHook('PATCH', 'resin', 'release', releaseUpdateTimestampHook);
hooks.addPureHook('POST', 'resin', 'release', releaseUpdateTimestampHook);
