import * as _ from 'lodash';

import { addDeleteHookForDependents } from '../../infra/cascade-delete';

addDeleteHookForDependents('release', [
	['release_tag', 'release'],
	['image__is_part_of__release', 'is_part_of__release'],
	['image_install', 'is_provided_by__release'],
]);
