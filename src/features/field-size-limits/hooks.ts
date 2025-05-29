import { addHooksForFieldSizeLimitChecks } from './setup-field-size-limits.js';

addHooksForFieldSizeLimitChecks('resin', 'api_key', {
	name: 50,
	description: 50,
});

addHooksForFieldSizeLimitChecks('resin', 'organization', {
	name: 100,
	handle: 100,
});

addHooksForFieldSizeLimitChecks('resin', 'application', {
	// That should be the max GH repo url since the max handle size is 39 and the max repo slug is 100.
	is_stored_at__repository_url: 159,
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
	// TODO Confirm 4k vs 1k
	value: [0, 4_000],
});

addHooksForFieldSizeLimitChecks('resin', 'release_tag', {
	// TODO Confirm
	tag_key: [0, 100],
});
