import * as _ from 'lodash';
import Bluebird = require('bluebird');
import { captureException } from '../../platform/errors';
import { sbvrUtils, permissions } from '@balena/pinejs';
import { getAllDeviceTypes } from '.';
import { DeviceType } from './build-info-facade';

const DEVICE_TYPES_CACHE_EXPIRATION = 5 * 1000; // 5 mins
const RETRY_WAIT_TIME = 10 * 1000;

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

	await sbvrUtils.db.transaction(async (tx) => {
		const rootApi = sbvrUtils.api.resin.clone({
			passthrough: { req: permissions.root, tx },
		});

		const existingDeviceTypes = (await rootApi.get({
			resource: 'device_type',
			options: { $select: ['slug'] },
		})) as Array<{ slug: string }>;

		const existingSlugs = new Set(
			existingDeviceTypes.map((deviceType) => deviceType.slug),
		);

		await Promise.all(
			mappedDeviceTypes.map(async (deviceType) => {
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
			}),
		);
	});
};

export const startDeviceTypeSynchronization = async () => {
	while (true) {
		try {
			await syncDeviceTypes();
			await Bluebird.delay(DEVICE_TYPES_CACHE_EXPIRATION);
		} catch (err) {
			captureException(err, 'Failed to synchronize device types');
			await Bluebird.delay(RETRY_WAIT_TIME);
		}
	}
};
