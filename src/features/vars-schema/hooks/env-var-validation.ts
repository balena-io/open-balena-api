import { hooks } from '@balena/pinejs';

import { checkEnvVarNameValidity, checkEnvVarValueValidity } from '../env-vars';

const envVarHook: hooks.Hooks = {
	POSTPARSE: async ({ request }) => {
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
	'device_application_environment_variable',
	'service_environment_variable',
	'device_service_environment_variable',
]) {
	for (const method of ['POST', 'PATCH', 'PUT', 'DELETE'] as const) {
		hooks.addPureHook(method, 'resin', resource, envVarHook);
	}
}
