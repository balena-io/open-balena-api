import { expect } from 'chai';

import { supertest } from './test-lib/supertest.js';
import { LOGS_HOST, VPN_HOST, VPN_PORT } from '@balena/open-balena-api/config';

export default () => {
	describe('OS configuration endpoints', () => {
		describe('/os/v1/config', () => {
			it('should return a valid JSON response', async () => {
				const { body } = await supertest().get('/os/v1/config').expect(200);

				// Service configurations should be valid for their respective services
				expect(body)
					.to.have.property('services')
					.that.has.all.keys('openvpn', 'ssh');
				expect(body.services.openvpn).to.have.all.keys('config', 'ca');
				expect(body.services.openvpn.config).to.equal(`
client
remote ${VPN_HOST} ${VPN_PORT}
resolv-retry infinite

remote-cert-tls server
tls-version-min 1.2
ca /etc/openvpn/ca.crt
auth-user-pass /var/volatile/vpn-auth
auth-retry none
script-security 2
up /etc/openvpn-misc/upscript.sh
up-restart
down /etc/openvpn-misc/downscript.sh

comp-lzo
dev resin-vpn
dev-type tun
proto tcp
nobind

persist-key
persist-tun
verb 3
user openvpn
group openvpn

reneg-bytes 0
reneg-pkts 0
reneg-sec 0
`);
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
							...(LOGS_HOST != null && {
								logsEndpoint: `https://${LOGS_HOST}`,
							}),
						},
					});
			});
		});
	});
};
