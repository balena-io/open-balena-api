import * as _ from 'lodash';
import { RequestHandler } from 'express';
import { JSONSchema6 } from 'json-schema';

import {
	RESERVED_NAMES,
	RESERVED_NAMESPACES,
	INVALID_CHARACTER_REGEX,
	CONFIG_VAR_NAMES,
	CONFIG_VAR_NAMESPACES,
	BLACKLISTED_NAMES,
	SUPERVISOR_CONFIG_VAR_PROPERTIES,
	HOST_CONFIG_CAPABLE_DEVICE_TYPES,
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

			...(_.includes(HOST_CONFIG_CAPABLE_DEVICE_TYPES, req.query.deviceType)
				? HOST_CONFIG_VAR_PROPERTIES
				: {}),
		},
	};

	const varsConfig = {
		reservedNames: RESERVED_NAMES,
		reservedNamespaces: RESERVED_NAMESPACES,
		invalidRegex: INVALID_CHARACTER_REGEX.toString(),
		whiteListedNames: CONFIG_VAR_NAMES,
		whiteListedNamespaces: CONFIG_VAR_NAMESPACES,
		blackListedNames: BLACKLISTED_NAMES,
		configVarSchema: schema,
	};

	res.json(varsConfig);
};
