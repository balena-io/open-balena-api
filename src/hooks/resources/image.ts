import { addDeleteHookForDependents } from '../../infra/cascade-delete';

addDeleteHookForDependents('image', [
	['image_install', 'installs__image'],
	['image__is_part_of__release', 'image'],
	['gateway_download', 'image'],
]);
