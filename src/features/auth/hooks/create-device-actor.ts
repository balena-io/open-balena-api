import { hooks } from '@balena/pinejs';

import { createActor } from '../../../infra/auth/create-actor.js';

hooks.addPureHook('POST', 'resin', 'device', {
	POSTPARSE: createActor,
});
