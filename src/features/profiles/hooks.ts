import { hooks } from '@balena/pinejs';
import { withValidatedValues, z } from '../../infra/validation/index.js';
import type Model from '../../balena-model.js';

// Matches docker-compose profile name semantics, see
// https://docs.docker.com/compose/how-tos/profiles/
const PROFILE_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/;

const profileName = z.string().regex(PROFILE_NAME_REGEX);

const imageProfileSchema = z.looseObject({
	profile_name: profileName,
});

const applicationProfileSchema = z.looseObject({
	activates__profile_name: profileName,
});

type ProfileResource = Extract<
	keyof Model,
	'image_profile' | 'application_profile'
>;

const registerProfileValidation = (
	resource: ProfileResource,
	schema: z.ZodType<AnyObject>,
) => {
	const hook: hooks.Hooks = {
		POSTPARSE: withValidatedValues(schema),
	};
	hooks.addPureHook('POST', 'resin', resource, hook);
	hooks.addPureHook('PUT', 'resin', resource, hook);
	hooks.addPureHook('PATCH', 'resin', resource, hook);
};

registerProfileValidation('image_profile', imageProfileSchema);
registerProfileValidation('application_profile', applicationProfileSchema);
