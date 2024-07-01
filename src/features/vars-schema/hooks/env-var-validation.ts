import { hooks } from '@balena/pinejs';

import {
	checkEnvVarNameValidity,
	checkEnvVarValueValidity,
} from '../env-vars.js';

const envVarHook: hooks.Hooks = {
	POSTPARSE: ({ request }) => {
		const { name, value } = request.values;

		if (name != null) {
			checkEnvVarNameValidity(name);
		}
		if (value != null) {
			checkEnvVarValueValidity(value);
		}
	},
};

for (const resource of [
	'application_environment_variable',
	'device_environment_variable',
	'service_environment_variable',
	'device_service_environment_variable',
]) {
	for (const method of ['POST', 'PATCH', 'PUT'] as const) {
		hooks.addPureHook(method, 'resin', resource, envVarHook);
	}
}
