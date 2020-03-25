import { sbvrUtils } from '@resin/pinejs';

import { checkTagKeyValidity } from '../../lib/tags';

// Tag hooks
const addTagHooks = (resource: string) => {
	const nameProp = 'tag_key';
	const tagHook: sbvrUtils.Hooks = {
		POSTPARSE: ({ request }) => {
			if (request.values[nameProp] != null) {
				checkTagKeyValidity(request.values[nameProp]);
			}
		},
	};

	sbvrUtils.addPureHook('POST', 'resin', resource, tagHook);
	sbvrUtils.addPureHook('PUT', 'resin', resource, tagHook);
	sbvrUtils.addPureHook('PATCH', 'resin', resource, tagHook);
};

['application_tag', 'device_tag', 'release_tag'].forEach(addTagHooks);
