import { expect } from 'chai';
import type { ErrorEvent } from '@sentry/node';
import { redactRequestBody } from '../src/infra/error-handling/redact-request-body.js';

const redact = (request: NonNullable<ErrorEvent['request']>) =>
	redactRequestBody({ type: undefined, request }).request?.data;

export default () => {
	describe('Sentry request body redaction', () => {
		it('should redact sensitive keys in JSON bodies', () => {
			expect(
				redact({
					url: 'https://api.balena-cloud.com/login_',
					headers: { 'content-type': 'application/json' },
					data: JSON.stringify({ username: 'bob', password: 'hunter2' }),
				}),
			).to.equal(JSON.stringify({ username: 'bob', password: '[Filtered]' }));
		});

		it('should redact nested sensitive keys', () => {
			expect(
				redact({
					url: 'https://api.balena-cloud.com/device/register',
					data: JSON.stringify({
						uuid: 'abc',
						nested: [{ api_key: 'secret', deviceApiKey: 'secret', name: 'a' }],
					}),
				}),
			).to.equal(
				JSON.stringify({
					uuid: 'abc',
					nested: [
						{ api_key: '[Filtered]', deviceApiKey: '[Filtered]', name: 'a' },
					],
				}),
			);
		});

		it('should redact the value of env and config vars', () => {
			for (const resource of [
				'device_environment_variable',
				'device_service_environment_variable(123)',
				'application_config_variable',
			]) {
				expect(
					redact({
						url: `https://api.balena-cloud.com/v7/${resource}`,
						data: JSON.stringify({ name: 'MY_VAR', value: 'secret' }),
					}),
				).to.equal(JSON.stringify({ name: 'MY_VAR', value: '[Filtered]' }));
			}
		});

		it('should not redact the value of other resources', () => {
			expect(
				redact({
					url: 'https://api.balena-cloud.com/v7/device_tag(123)',
					data: JSON.stringify({ value: 'office' }),
				}),
			).to.equal(JSON.stringify({ value: 'office' }));
		});

		it('should redact sensitive keys in urlencoded bodies', () => {
			expect(
				redact({
					url: 'https://api.balena-cloud.com/login_',
					headers: { 'content-type': 'application/x-www-form-urlencoded' },
					data: 'username=bob&password=hunter2',
				}),
			).to.equal('username=bob&password=%5BFiltered%5D');
		});

		it('should redact the entirety of bodies that it cannot parse', () => {
			expect(
				redact({
					url: 'https://api.balena-cloud.com/login_',
					headers: { 'content-type': 'application/json' },
					data: '{"username":"bob","password":"hunt',
				}),
			).to.equal('[Filtered]');
			expect(
				redact({
					url: 'https://api.balena-cloud.com/v7/release_asset',
					headers: { 'content-type': 'multipart/form-data; boundary=x' },
					data: '--x\r\nContent-Disposition: form-data; name="asset"',
				}),
			).to.equal('[Filtered]');
		});

		it('should leave events without a request body untouched', () => {
			const event: ErrorEvent = {
				type: undefined,
				request: { url: 'https://api.balena-cloud.com/ping', method: 'GET' },
			};
			expect(redactRequestBody(event)).to.deep.equal({
				type: undefined,
				request: { url: 'https://api.balena-cloud.com/ping', method: 'GET' },
			});
		});
	});
};
