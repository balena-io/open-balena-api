import { hooks } from '@balena/pinejs';

import {
	checkConfigVarNameValidity,
	checkEnvVarValueValidity,
} from '../env-vars.js';

const configVarHook: hooks.Hooks = {
	POSTPARSE: ({ request }) => {
		const { name, value } = request.values;

		if (name != null) {
			checkConfigVarNameValidity(name);
		}
		if (value != null) {
			checkEnvVarValueValidity(value);
		}
	},
};

for (const resource of [
	'application_config_variable',
	'device_config_variable',
]) {
	for (const method of ['POST', 'PATCH', 'PUT'] as const) {
		hooks.addPureHook(method, 'resin', resource, configVarHook);
	}
}
