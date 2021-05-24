import { sbvrUtils, permissions } from '@balena/pinejs';
import { setDefaultFixtures } from './fixtures';

const { api } = sbvrUtils;

export interface DeviceType {
	id: number;
	slug: string;
	name: string;
}

setDefaultFixtures(
	'deviceTypes',
	new Proxy({} as Dictionary<DeviceType>, {
		get: async (obj, slug) => {
			if (typeof slug === 'string' && !obj.hasOwnProperty(slug)) {
				if (slug === 'then') {
					// Something is checking if we're a thenable
					return;
				}
				const deviceType = (await api.resin.get({
					resource: 'device_type',
					passthrough: {
						req: permissions.root,
					},
					id: {
						slug,
					},
					options: {
						$select: ['id', 'slug', 'name'],
					},
				})) as DeviceType;
				obj[slug] = deviceType;
			}

			return obj[slug as any];
		},
	}) as any as Dictionary<Promise<DeviceType>>,
);
