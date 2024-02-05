import { registerTagHooks } from './validation.js';

['application_tag', 'device_tag', 'release_tag'].forEach(registerTagHooks);
