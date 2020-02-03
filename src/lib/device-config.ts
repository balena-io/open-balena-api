import * as _ from 'lodash';

import * as fs from 'fs';

import * as deviceConfig from 'resin-device-config';
import * as resinSemver from 'resin-semver';

import { DeviceType } from './device-types';

import { Option as DeviceTypeOption } from '@resin.io/device-types';
import { sbvrUtils } from '@resin/pinejs';
import { Request } from 'express';
import { getUser } from '../platform/auth';
import { captureException } from '../platform/errors';
import { createProvisioningApiKey, createUserApiKey } from './api-keys';

const { BadRequestError } = sbvrUtils;

// FIXME(refactor): many of the following are resin-specific
import {
	API_HOST,
	DELTA_HOST,
	MIXPANEL_TOKEN,
	NODE_EXTRA_CA_CERTS,
	REGISTRY2_HOST,
	VPN_HOST,
	VPN_PORT,
} from './config';

export const generateConfig = async (
	req: Request,
	app: AnyObject,
	deviceType: DeviceType,
	osVersion: string,
) => {
	const userPromise = getUser(req);

	// Devices running ResinOS >=1.2.1 are capable of using Registry v2, while earlier ones must use v1
	if (resinSemver.lte(osVersion, '1.2.0')) {
		throw new BadRequestError(
			'balenaOS versions <= 1.2.0 are no longer supported, please update',
		);
	}
	const registryHost = REGISTRY2_HOST;

	const apiKeyPromise = (async () => {
		// Devices running ResinOS >= 2.7.8 can use provisioning keys
		if (resinSemver.satisfies(osVersion, '<2.7.8')) {
			// Older ones have to use the old "user api keys"
			return createUserApiKey(req, (await userPromise).id);
		}
		return createProvisioningApiKey(req, app.id);
	})();

	// There may be multiple CAs, this doesn't matter as all will be passed in the config
	const selfSignedRootPromise = (async () => {
		const caFile = NODE_EXTRA_CA_CERTS;
		if (!caFile) {
			return;
		}
		try {
			await fs.promises.stat(caFile);
			const pem = await fs.promises.readFile(caFile, 'utf8');
			return Buffer.from(pem).toString('base64');
		} catch (err) {
			if (err.code !== 'ENOENT') {
				captureException(err, 'Self-signed root CA could not be read');
			}
		}
	})();

	const user = await userPromise;
	const apiKey = await apiKeyPromise;
	const rootCA = await selfSignedRootPromise;

	const config = deviceConfig.generate(
		{
			application: app as deviceConfig.GenerateOptions['application'],
			deviceType: deviceType.slug,
			user,
			apiKey,
			pubnub: {},
			mixpanel: {
				token: MIXPANEL_TOKEN,
			},
			vpnPort: VPN_PORT,
			endpoints: {
				api: `https://${API_HOST}`,
				delta: `https://${DELTA_HOST}`,
				registry: registryHost,
				vpn: VPN_HOST,
			},
			version: osVersion,
		},
		{
			appUpdatePollInterval:
				_.parseInt(req.param('appUpdatePollInterval')) * 60 * 1000,
			network: req.param('network'),
			wifiSsid: req.param('wifiSsid'),
			wifiKey: req.param('wifiKey'),
			ip: req.param('ip'),
			gateway: req.param('gateway'),
			netmask: req.param('netmask'),
		},
	);

	_(deviceType.options!)
		.flatMap((opt): DeviceTypeOption[] | DeviceTypeOption => {
			if (opt.isGroup && ['network', 'advanced'].includes(opt.name)) {
				// already handled above
				return [];
			} else if (opt.isGroup) {
				return opt.options;
			} else {
				return opt;
			}
		})
		.each(({ name: optionName }) => {
			config[optionName] = req.param(optionName);
		});
	if (rootCA != null) {
		config.balenaRootCA = rootCA;
	}
	return config;
};
