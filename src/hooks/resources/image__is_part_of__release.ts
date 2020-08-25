import { addDeleteHookForDependents } from '../../infra/cascade-delete';

addDeleteHookForDependents('image__is_part_of__release', [
	['image_label', 'release_image'],
	['image_environment_variable', 'release_image'],
]);
