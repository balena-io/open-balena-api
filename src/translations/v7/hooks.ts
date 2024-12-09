import { addDeleteHookForDependents } from '../../infra/cascade-delete/index.js';

// Service install resource should only be used for <= v7 translations
addDeleteHookForDependents('v7', 'service_install', {
	device_service_environment_variable: 'service_install',
});
