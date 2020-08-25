import { addDeleteHookForDependents } from '../../infra/cascade-delete';

addDeleteHookForDependents('service', [
	['service_environment_variable', 'service'],
	['service_install', 'installs__service'],
	['image', 'is_a_build_of__service'],
	['service_label', 'service'],
]);
