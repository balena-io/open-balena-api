import { hooks } from '@balena/pinejs';

import {
	checkConfigVarNameValidity,
	checkEnvVarValueValidity,
} from '../env-vars';

const configVarHook: hooks.Hooks = {
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
	'service_config_variable',
	'device_service_config_variable',
	'image_config_variable',
]) {
	for (const method of ['POST', 'PATCH', 'PUT'] as const) {
		hooks.addPureHook(method, 'resin', resource, configVarHook);
	}
}
