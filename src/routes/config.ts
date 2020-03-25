import type { RequestHandler } from 'express';
import type { JSONSchema6 } from 'json-schema';

import {
	BLACKLISTED_NAMES,
	DEVICE_TYPE_SPECIFIC_CONFIG_VAR_PROPERTIES,
	INVALID_CHARACTER_REGEX,
	RESERVED_NAMES,
	RESERVED_NAMESPACES,
	SUPERVISOR_CONFIG_VAR_PROPERTIES,
	WHITELISTED_NAMES,
	WHITELISTED_NAMESPACES,
} from '../lib/env-vars';

// Return config variable constants for use by external components.
// A query string parameter of 'deviceType' is accepted, which should
// be a device type slug.
export const vars: RequestHandler = (req, res) => {
	const schema: JSONSchema6 = {
		type: 'object',
		$schema: 'http://json-schema.org/draft-06/schema#',
		properties: Object.assign(
			{},
			SUPERVISOR_CONFIG_VAR_PROPERTIES,
			...DEVICE_TYPE_SPECIFIC_CONFIG_VAR_PROPERTIES.filter((config) =>
				config.capableDeviceTypes.includes(req.query.deviceType),
			).map((config) => config.properties),
		),
	};

	const varsConfig = {
		reservedNames: RESERVED_NAMES,
		reservedNamespaces: RESERVED_NAMESPACES,
		invalidRegex: INVALID_CHARACTER_REGEX.toString(),
		whiteListedNames: WHITELISTED_NAMES,
		whiteListedNamespaces: WHITELISTED_NAMESPACES,
		blackListedNames: BLACKLISTED_NAMES,
		configVarSchema: schema,
	};

	res.json(varsConfig);
};
