import { addDeleteHookForDependents } from '../../infra/cascade-delete';

addDeleteHookForDependents('service_install', [
	['device_service_environment_variable', 'service_install'],
]);
