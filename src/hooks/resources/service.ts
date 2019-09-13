import { addDeleteHookForDependents } from '../../platform';

addDeleteHookForDependents('service', [
	['service_environment_variable', 'service'],
	['device_service_environment_variable', 'applies_to__service'],
	['service_install', 'installs__service'],
	['image', 'is_a_build_of__service'],
	['service_label', 'service'],
]);
