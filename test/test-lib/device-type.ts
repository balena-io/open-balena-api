import { sbvrUtils, permissions } from '@resin/pinejs';
import { setDefaultFixtures } from './fixtures';

const { api } = sbvrUtils;

interface DeviceType {
	id: number;
	slug: string;
	name: string;
}

setDefaultFixtures(
	'deviceTypes',
	(new Proxy({} as Dictionary<DeviceType>, {
		get: async (obj, slug) => {
			if (typeof slug === 'string' && !obj.hasOwnProperty(slug)) {
				if (slug === 'then') {
					// Something is checking if we're a thenable
					return;
				}
				const deviceTypes = (await api.resin.get({
					resource: 'device_type',
					passthrough: {
						req: permissions.root,
					},
					options: {
						$select: ['id', 'slug', 'name'],
						$filter: {
							slug,
						},
					},
				})) as DeviceType[];
				obj[slug] = deviceTypes[0];
			}
			return obj[slug as any];
		},
	}) as any) as Dictionary<Promise<DeviceType>>,
);
