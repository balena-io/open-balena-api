import { addHooksForFieldSizeLimitChecks } from './setup-field-size-limits.js';

addHooksForFieldSizeLimitChecks('resin', 'api_key', {
	name: 50,
	description: 150,
});

addHooksForFieldSizeLimitChecks('resin', 'organization', {
	name: 100,
	handle: 100,
});

for (const resource of [
	'application_config_variable',
	'application_environment_variable',
	'device_config_variable',
	'device_environment_variable',
	'device_service_environment_variable',
]) {
	addHooksForFieldSizeLimitChecks('resin', resource, {
		value: 100_000,
	});
}

addHooksForFieldSizeLimitChecks('resin', 'device_tag', {
	value: [0, 10_000],
});
