import { hooks, errors } from '@balena/pinejs';
import * as uuid from 'uuid';
import { DefaultApplicationType } from '../../application-types/application-types';

// reconstitute the value into a properly formatted UUID...
const toUuid = (strippedUuid: string): string => {
	if (strippedUuid.length !== 32) {
		return '';
	}

	return [
		strippedUuid.substr(0, 8),
		strippedUuid.substr(8, 4),
		strippedUuid.substr(12, 4),
		strippedUuid.substr(16, 4),
		strippedUuid.substr(20, 12),
	].join('-');
};

hooks.addPureHook('POST', 'resin', 'application', {
	POSTPARSE: async ({ request }) => {
		request.values.application_type ??= DefaultApplicationType.id;

		if (!/^[a-zA-Z0-9_-]+$/.test(request.values.app_name)) {
			throw new errors.BadRequestError(
				'App name may only contain [a-zA-Z0-9_-].',
			);
		}

		request.values.uuid = request.values.uuid ?? uuid.v4().replace(/-/g, '');

		const appUuid = toUuid(request.values.uuid);
		if (!uuid.validate(appUuid) || uuid.version(appUuid) !== 4) {
			throw new errors.BadRequestError(
				'Application UUID must be a 32 character long lower case UUID version 4.',
			);
		}

		request.values.should_track_latest_release = true;
	},
});
