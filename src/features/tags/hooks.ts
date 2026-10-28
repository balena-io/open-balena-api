import { registerTagHooks } from './validation.ts';

for (const tagType of ['application_tag', 'device_tag', 'release_tag']) {
	registerTagHooks(tagType);
}
