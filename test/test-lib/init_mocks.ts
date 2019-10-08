import './aws-mock';
import './github-mock';

import * as fs from 'fs';
import * as nock from 'nock';
import * as path from 'path';

import { DeviceOnlineStateManager } from '../../src/lib/device-online-state';
(DeviceOnlineStateManager as any)['QUEUE_STATS_INTERVAL_MSEC'] = 1000;

nock('https://codeload.github.com')
	.get('/balena-io/contracts/legacy.tar.gz/master')
	.reply(200, () => {
		return fs.createReadStream(
			path.join(
				__dirname,
				'../fixtures/github/balena_io_contracts_master.tar.gz',
			),
		);
	});

export {};
