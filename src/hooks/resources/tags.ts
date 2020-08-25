import { hooks } from '@balena/pinejs';

import { checkTagKeyValidity } from '../../features/tags/tags';

// Tag hooks
const addTagHooks = (resource: string) => {
	const nameProp = 'tag_key';
	const tagHook: hooks.Hooks = {
		POSTPARSE: ({ request }) => {
			if (request.values[nameProp] != null) {
				checkTagKeyValidity(request.values[nameProp]);
			}
		},
	};

	hooks.addPureHook('POST', 'resin', resource, tagHook);
	hooks.addPureHook('PUT', 'resin', resource, tagHook);
	hooks.addPureHook('PATCH', 'resin', resource, tagHook);
};

['application_tag', 'device_tag', 'release_tag'].forEach(addTagHooks);
