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

const deviceProfileOverrideSchema = z.looseObject({
	overrides__profile_name: profileName,
	is_active: z.boolean(),
});

const deviceProfileOverrideUpdateSchema = z.looseObject({
	is_active: z.boolean().optional(),
});

type ProfileResource = Extract<
	keyof Model,
	'image_profile' | 'application_profile' | 'device_profile_override'
>;

const registerProfileValidation = (
	resource: ProfileResource,
	schema: z.ZodType<AnyObject>,
	updateSchema: z.ZodType<AnyObject> = schema,
) => {
	hooks.addPureHook('POST', 'resin', resource, {
		POSTPARSE: withValidatedValues(schema),
	});
	hooks.addPureHook('PUT', 'resin', resource, {
		POSTPARSE: withValidatedValues(schema),
	});
	hooks.addPureHook('PATCH', 'resin', resource, {
		POSTPARSE: withValidatedValues(updateSchema),
	});
};

registerProfileValidation('image_profile', imageProfileSchema);
registerProfileValidation('application_profile', applicationProfileSchema);
registerProfileValidation(
	'device_profile_override',
	deviceProfileOverrideSchema,
	deviceProfileOverrideUpdateSchema,
);
