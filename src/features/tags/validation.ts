import { errors, hooks } from '@balena/pinejs';

const RESERVED_NAMESPACES = ['io.resin.', 'io.balena.'];

const checkTagKeyValidity = (key: string) => {
	if (/\s/.test(key)) {
		throw new errors.BadRequestError('Tag keys cannot contain whitespace.');
	}
	for (const ns of RESERVED_NAMESPACES) {
		if (key.startsWith(ns)) {
			throw new errors.BadRequestError(
				`Tag keys beginning with ${ns} are reserved.`,
			);
		}
	}
};

// Tag hooks
export const registerTagHooks = (resource: string) => {
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
