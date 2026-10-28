import { hooks } from '@balena/pinejs';

import { createActor } from '../../../infra/auth/create-actor.ts';

hooks.addPureHook('POST', 'resin', 'device', {
	POSTPARSE: createActor,
});
