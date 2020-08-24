import * as _ from 'lodash';
import Bluebird = require('bluebird');
import { captureException } from '../../infra/error-handling';
import { sbvrUtils, permissions } from '@balena/pinejs';
import { getAllDeviceTypes } from '.';
import { DeviceType } from './build-info-facade';

const DEVICE_TYPES_SYNC_INTERVAL = 5 * 60 * 1000; // 5 mins

type DeviceTypeResourceKeys = 'slug' | 'name' | 'is_private';

// This map will hold information on which device type fields imported from the device type registry will be synced to which db fields.
export const syncSettings: {
	map: {
		[k in DeviceTypeResourceKeys]?: {
			name: keyof DeviceType;
			default?: any;
		};
	};
} = {
	map: { slug: { name: 'slug' } },
};

export function setSyncMap(map: typeof syncSettings['map']) {
	syncSettings.map = _.merge(map, syncSettings.map);
}

const mapModel = (deviceType: DeviceType, map: typeof syncSettings['map']) => {
	const mappedModel: { [k in DeviceTypeResourceKeys]?: any } = {};
	for (const key of Object.keys(map) as Array<keyof typeof map>) {
		mappedModel[key] = deviceType[map[key]!.name] ?? map[key]!.default;
	}

	return mappedModel;
};

const syncDeviceTypes = async () => {
	const deviceTypes = await getAllDeviceTypes();
	const mappedDeviceTypes = deviceTypes.map((deviceType) =>
		mapModel(deviceType, syncSettings.map),
	);

	const rootApi = sbvrUtils.api.resin.clone({
		passthrough: { req: permissions.root },
	});

	const existingDeviceTypes = (await rootApi.get({
		resource: 'device_type',
		options: { $select: ['slug'] },
	})) as Array<{ slug: string }>;

	const existingSlugs = new Set(
		existingDeviceTypes.map((deviceType) => deviceType.slug),
	);

	await Bluebird.map(
		mappedDeviceTypes,
		async (deviceType) => {
			try {
				if (existingSlugs.has(deviceType.slug)) {
					return await rootApi.patch({
						resource: 'device_type',
						body: deviceType,
						options: {
							$filter: { slug: deviceType.slug },
							returnResource: false,
						},
					});
				}

				await rootApi.post({
					resource: 'device_type',
					body: deviceType,
					options: { returnResource: false },
				});
			} catch (err) {
				console.error(
					`Failed to synchronize ${deviceType.slug}, skipping...`,
					err.message,
				);
			}
		},
		{ concurrency: 10 },
	);
};

export const startDeviceTypeSynchronization = async () => {
	while (true) {
		try {
			await syncDeviceTypes();
		} catch (err) {
			captureException(err, 'Failed to synchronize device types');
		}

		await Bluebird.delay(DEVICE_TYPES_SYNC_INTERVAL);
	}
};
