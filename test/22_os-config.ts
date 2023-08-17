import { expect } from 'chai';

import { supertest } from './test-lib/supertest';
import { LOGS_HOST } from '../src/lib/config';

describe('OS configuration endpoints', () => {
	describe('/os/v1/config', () => {
		it('should return a valid JSON response', async () => {
			const { body } = await supertest().get('/os/v1/config').expect(200);

			// Service configurations should be valid for their respective services
			expect(body)
				.to.have.property('services')
				.that.has.all.keys('openvpn', 'ssh');
			expect(body.services.openvpn).to.have.all.keys('config', 'ca');
			expect(body.services.openvpn.config).to.be.a('string');
			expect(body.services.openvpn.ca).to.be.a('string');
			expect(body.services.ssh)
				.to.have.property('authorized_keys')
				.that.is.a('string');

			// schema_version is kept for backwards compatibility
			expect(body).to.have.property('schema_version').that.equals('1.0.0');

			// Config should contain config.json overrides
			expect(body)
				.to.have.property('config')
				.that.deep.equals({
					overrides: {
						...(LOGS_HOST != null && { logsEndpoint: `https://${LOGS_HOST}` }),
					},
				});
		});
	});
});
