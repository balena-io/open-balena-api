import { registerTagHooks } from './validation.js';

for (const tagType of ['application_tag', 'device_tag', 'release_tag']) {
	registerTagHooks(tagType);
}
