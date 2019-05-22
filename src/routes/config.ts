import * as _ from 'lodash';
import { RequestHandler } from 'express';
import { JSONSchema6 } from 'json-schema';

import {
	RESERVED_NAMES,
	RESERVED_NAMESPACES,
	INVALID_CHARACTER_REGEX,
	WHITELISTED_NAMES,
	WHITELISTED_NAMESPACES,
	BLACKLISTED_NAMES,
	SUPERVISOR_CONFIG_VAR_PROPERTIES,
	RESIN_HOST_CONFIG_CAPABLE_DEVICE_TYPES,
	HOST_CONFIG_VAR_PROPERTIES,
} from '../lib/env-vars';

// Return config variable constants for use by external components.
// A query string parameter of 'deviceType' is accepted, which should
// be a device type slug.
export const vars: RequestHandler = (req, res) => {
	const schema: JSONSchema6 = {
		type: 'object',
		$schema: 'http://json-schema.org/draft-06/schema#',
		properties: {
			...SUPERVISOR_CONFIG_VAR_PROPERTIES,

			...(RESIN_HOST_CONFIG_CAPABLE_DEVICE_TYPES.includes(req.query.deviceType)
				? HOST_CONFIG_VAR_PROPERTIES
				: {}),
		},
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
