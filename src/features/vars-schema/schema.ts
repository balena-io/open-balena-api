import type { RequestHandler } from 'express';
import type { JSONSchema6 } from 'json-schema';
import { sbvrUtils } from '@balena/pinejs';
import {
	BLOCKED_NAMES,
	DEVICE_TYPE_SPECIFIC_CONFIG_VAR_PROPERTIES,
	INVALID_ENV_VAR_REGEX,
	INVALID_CONFIG_VAR_REGEX,
	RESERVED_NAMES,
	RESERVED_NAMESPACES,
	SUPERVISOR_CONFIG_VAR_PROPERTIES,
	ALLOWED_NAMES,
	ALLOWED_NAMESPACES,
} from './env-vars';

const { api } = sbvrUtils;

// Return config variable constants for use by external components.
// A query string parameter of 'deviceType' is accepted, which should
// be a device type slug.
export const schema: RequestHandler = async (req, res) => {
	const deviceTypeSlug = await (async () => {
		if (typeof req.query.deviceType !== 'string') {
			return;
		}

		const resinApi = api.resin.clone({ passthrough: { req } });
		// Ensure that the user has access to the provided device type.
		const [dt] = (await resinApi.get({
			resource: 'device_type',
			options: {
				$top: 1,
				$select: 'slug',
				$filter: {
					device_type_alias: {
						$any: {
							$alias: 'dta',
							$expr: {
								dta: {
									is_referenced_by__alias: req.query.deviceType,
								},
							},
						},
					},
				},
			},
		})) as Array<{ slug: string }>;

		// We do not throw when the DT is not found for backwards compatibility reasons.
		return dt?.slug;
	})();

	const configVarSchema: JSONSchema6 = {
		type: 'object',
		$schema: 'http://json-schema.org/draft-06/schema#',
		properties: Object.assign(
			{},
			SUPERVISOR_CONFIG_VAR_PROPERTIES,
			...(deviceTypeSlug != null
				? DEVICE_TYPE_SPECIFIC_CONFIG_VAR_PROPERTIES.filter((config) =>
						config.capableDeviceTypes.includes(deviceTypeSlug),
				  ).map((config) => config.properties)
				: []),
		),
	};

	const varsConfig = {
		reservedNames: RESERVED_NAMES,
		reservedNamespaces: RESERVED_NAMESPACES,
		invalidRegex: INVALID_ENV_VAR_REGEX.toString(),
		configVarInvalidRegex: INVALID_CONFIG_VAR_REGEX.toString(),
		whiteListedNames: ALLOWED_NAMES,
		whiteListedNamespaces: ALLOWED_NAMESPACES,
		blackListedNames: BLOCKED_NAMES,
		configVarSchema,
	};

	res.json(varsConfig);
};
