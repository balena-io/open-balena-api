import { hooks } from '@balena/pinejs';
import { withValidatedValues, z } from '../../infra/validation/index.js';

// Matches docker-compose profile name semantics, see
// https://docs.docker.com/compose/how-tos/profiles/
const PROFILE_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/;

const profileNameSchema = z.looseObject({
	profile_name: z.string().regex(PROFILE_NAME_REGEX),
});

const imageProfileHook: hooks.Hooks = {
	POSTPARSE: withValidatedValues(profileNameSchema),
};

hooks.addPureHook('POST', 'resin', 'image_profile', imageProfileHook);
hooks.addPureHook('PUT', 'resin', 'image_profile', imageProfileHook);
hooks.addPureHook('PATCH', 'resin', 'image_profile', imageProfileHook);
