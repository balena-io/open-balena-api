import type { hooks } from '@balena/pinejs';
import { sbvrUtils, permissions } from '@balena/pinejs';

export const createActor = async ({
	request,
	tx,
}: hooks.HookArgs): Promise<void> => {
	const result = await sbvrUtils.api.Auth.post({
		resource: 'actor',
		passthrough: {
			tx,
			req: permissions.root,
		},
		options: { returnResource: false },
	});
	request.values.actor = result.id;
};
