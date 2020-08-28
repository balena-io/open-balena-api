import { registerTagHooks } from './validation';

['application_tag', 'device_tag', 'release_tag'].forEach(registerTagHooks);
