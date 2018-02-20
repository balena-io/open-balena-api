import { addDeleteHookForDependents } from '../../platform';

addDeleteHookForDependents('service_install', [
	['device_service_environment_variable', 'service_install'],
]);
