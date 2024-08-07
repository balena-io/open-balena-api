import { sbvrUtils, permissions } from '@balena/pinejs';
import { setDefaultFixtures } from './fixtures.js';
import type { DeviceType } from '../../src/balena-model.js';

const { api } = sbvrUtils;

export const loadDefaultFixtures = () => {
	setDefaultFixtures(
		'deviceTypes',
		new Proxy(
			{} as Dictionary<
				Promise<Pick<DeviceType['Read'], 'id' | 'slug' | 'name'> | undefined>
			>,
			{
				get: (obj, slug) => {
					if (typeof slug === 'string' && !Object.hasOwn(obj, slug)) {
						if (slug === 'then') {
							// Something is checking if we're a thenable
							return;
						}
						const deviceType = api.resin.get({
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
						});
						obj[slug] = deviceType;
					}

					return obj[slug as keyof typeof obj];
				},
			},
		),
	);
};
