import type { RequestHandler } from 'express';
import type { JSONSchema6 } from 'json-schema';

import {
	BLOCKED_NAMES,
	DEVICE_TYPE_SPECIFIC_CONFIG_VAR_PROPERTIES,
	INVALID_CHARACTER_REGEX,
	RESERVED_NAMES,
	RESERVED_NAMESPACES,
	SUPERVISOR_CONFIG_VAR_PROPERTIES,
	ALLOWED_NAMES,
	ALLOWED_NAMESPACES,
} from './env-vars';

// Return config variable constants for use by external components.
// A query string parameter of 'deviceType' is accepted, which should
// be a device type slug.
export const schema: RequestHandler = (req, res) => {
	const configVarSchema: JSONSchema6 = {
		type: 'object',
		$schema: 'http://json-schema.org/draft-06/schema#',
		properties: Object.assign(
			{},
			SUPERVISOR_CONFIG_VAR_PROPERTIES,
			...DEVICE_TYPE_SPECIFIC_CONFIG_VAR_PROPERTIES.filter((config) =>
				config.capableDeviceTypes.includes(req.query.deviceType as string),
			).map((config) => config.properties),
		),
	};

	const varsConfig = {
		reservedNames: RESERVED_NAMES,
		reservedNamespaces: RESERVED_NAMESPACES,
		invalidRegex: INVALID_CHARACTER_REGEX.toString(),
		whiteListedNames: ALLOWED_NAMES,
		whiteListedNamespaces: ALLOWED_NAMESPACES,
		blackListedNames: BLOCKED_NAMES,
		configVarSchema,
	};

	res.json(varsConfig);
};
