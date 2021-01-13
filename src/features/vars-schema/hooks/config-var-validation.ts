import { hooks } from '@balena/pinejs';

import {
	checkConfigVarNameValidity,
	checkEnvVarValueValidity,
} from '../env-vars';

const envVarHook: hooks.Hooks = {
	POSTPARSE: async ({ request }) => {
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
		hooks.addPureHook(method, 'resin', resource, envVarHook);
	}
}
