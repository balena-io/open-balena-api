import type { Request } from 'express';
import fs from 'fs';
import _ from 'lodash';

import { errors, sbvrUtils } from '@balena/pinejs';
import * as semver from 'balena-semver';
import deviceConfig from 'balena-device-config';

import { getUser } from '../../infra/auth/auth';
import { captureException } from '../../infra/error-handling';

import {
	ApiKeyOptions,
	createProvisioningApiKey,
	createUserApiKey,
} from '../api-keys/lib';
import type { DeviceTypeJson } from '../device-types/device-type-json';

const { BadRequestError } = errors;

// FIXME(refactor): many of the following are resin-specific
import {
	API_HOST,
	DELTA_HOST,
	MIXPANEL_TOKEN,
	NODE_EXTRA_CA_CERTS,
	REGISTRY2_HOST,
	VPN_HOST,
	VPN_PORT,
	LOGS_HOST,
} from '../../lib/config';

// `osVersion == null` means assume "latest"
export const generateConfig = async (
	req: Request,
	app: deviceConfig.GenerateOptions['application'],
	deviceType: DeviceTypeJson,
	osVersion?: string,
) => {
	// Devices running ResinOS >=1.2.1 are capable of using Registry v2, while earlier ones must use v1
	if (osVersion != null && semver.lte(osVersion, '1.2.0')) {
		throw new BadRequestError(
			'balenaOS versions <= 1.2.0 are no longer supported, please update',
		);
	}

	const userAndApiKeyPromise = sbvrUtils.db.transaction(async (tx) => {
		const userPromise = getUser(req, tx);

		return await Promise.all([
			userPromise,
			(async () => {
				const apiKeyOptions: ApiKeyOptions = { tx };

				// Devices running ResinOS >= 2.7.8 can use provisioning keys
				if (osVersion != null && semver.satisfies(osVersion, '<2.7.8')) {
					// Older ones have to use the old "user api keys"
					return await createUserApiKey(
						req,
						(await userPromise).id,
						apiKeyOptions,
					);
				}

				// Checking both req.body and req.query given both GET and POST support
				// Ref: https://github.com/balena-io/balena-api/blob/master/src/routes/applications.ts#L95
				apiKeyOptions.name =
					req.body.provisioningKeyName ??
					req.query.provisioningKeyName ??
					'Automatically generated provisioning key';

				apiKeyOptions.description =
					req.body.provisioningKeyDescription ??
					req.query.provisioningKeyDescription ??
					'Automatically generated for an image download or config file generation';

				apiKeyOptions.expiryDate =
					req.body.provisioningKeyExpiryDate ??
					req.query.provisioningKeyExpiryDate ??
					undefined;

				return await createProvisioningApiKey(req, app.id, apiKeyOptions);
			})(),
		]);
	});

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

	const [user, apiKey] = await userAndApiKeyPromise;
	const rootCA = await selfSignedRootPromise;

	const config = deviceConfig.generate(
		{
			application: app,
			deviceType: deviceType.slug,
			user,
			apiKey,
			mixpanel: {
				token: MIXPANEL_TOKEN,
			},
			vpnPort: VPN_PORT,
			endpoints: {
				api: `https://${API_HOST}`,
				delta: `https://${DELTA_HOST}`,
				registry: REGISTRY2_HOST,
				vpn: VPN_HOST,
				// If undefined, balena-device-config won't generate a logs endpoint
				logs: LOGS_HOST != null ? `https://${LOGS_HOST}` : undefined,
			},
			version: osVersion,
		},
		{
			appUpdatePollInterval:
				parseInt(req.param('appUpdatePollInterval'), 10) * 60 * 1000,
			network: req.body.network ?? req.query.network,
			wifiSsid: req.param('wifiSsid'),
			wifiKey: req.param('wifiKey'),
			ip: req.param('ip'),
			gateway: req.param('gateway'),
			netmask: req.param('netmask'),
		},
	);

	_(deviceType.options!)
		.flatMap((opt) => {
			if ('isGroup' in opt && opt.isGroup) {
				if (['network', 'advanced'].includes(opt.name)) {
					// already handled above
					return [];
				} else {
					return opt.options;
				}
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

	const developmentMode = (
		req.param('developmentMode') ?? osVersion?.endsWith('.dev')
	)?.toString();
	if (['true', 'on', '1'].includes(developmentMode || '')) {
		config.developmentMode = true;
	}

	return config;
};
