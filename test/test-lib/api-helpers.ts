import jsonwebtoken from 'jsonwebtoken';
import type { PineTest } from 'pinejs-client-supertest';
import type { Release } from '../../src/balena-model.js';
import { expect } from 'chai';
import type { UserObjectParam } from '../test-lib/supertest.js';
import { supertest } from '../test-lib/supertest.js';
import type { TokenUserPayload } from '../../src/index.js';
import type { RequiredField } from '@balena/pinejs/out/sbvr-api/common-types.js';
import { assertExists } from './common.js';

const version = 'resin';

interface MockReleaseParams {
	belongs_to__application: number;
	is_created_by__user: number;
	commit: string;
	composition: AnyObject;
	status: string;
	source: string;
	build_log: string;
	start_timestamp: number;
	end_timestamp?: number;
	update_timestamp?: number;
	semver?: string;
}

interface MockImageParams {
	is_a_build_of__service: number;
	start_timestamp: number;
	end_timestamp: number;
	push_timestamp: number;
	status: string;
	image_size: number;
	project_type?: string;
	error_message?: string;
	build_log: string;
}

interface MockServiceParams {
	application: number;
	service_name: string;
}

type MockImage = MockImageParams & { id: number };
type MockService = MockServiceParams & { id: number };

export const addReleaseToApp = async (
	auth: UserObjectParam,
	release: MockReleaseParams,
): Promise<Release['Read']> =>
	(await supertest(auth).post(`/${version}/release`).send(release).expect(201))
		.body;

export const addImageToService = async (
	auth: UserObjectParam,
	image: MockImageParams,
): Promise<MockImage> =>
	(await supertest(auth).post(`/${version}/image`).send(image).expect(201))
		.body;

export const addServiceToApp = async (
	auth: UserObjectParam,
	serviceName: string,
	application: number,
): Promise<MockService> =>
	(
		await supertest(auth)
			.post(`/${version}/service`)
			.send({
				application,
				service_name: serviceName,
			})
			.expect(201)
	).body;

export const addImageToRelease = async (
	auth: UserObjectParam,
	imageId: number,
	releaseId: number,
): Promise<void> => {
	await supertest(auth)
		.post(`/${version}/image__is_part_of__release`)
		.send({
			image: imageId,
			is_part_of__release: releaseId,
		})
		.expect(201);
};

export const expectResourceToMatch = async <T = AnyObject>(
	pineUser: PineTest,
	resource: string,
	id: number | AnyObject,
	expectations: Dictionary<
		| null
		| string
		| number
		| boolean
		| object
		| ((chaiPropertyAssertion: Chai.Assertion, value: unknown) => void)
	>,
): Promise<T> => {
	const requestPromise = pineUser.get({
		resource,
		id,
		options: {
			$select: Object.keys(expectations),
		},
	});

	const result =
		// When providing a pinejs-client-supertest instance the promise will also have the `.expect*()` method
		// in which case we use it as an extra check that everything went fine.
		(
			'expect' in requestPromise
				? (await requestPromise.expect(200)).body
				: await (requestPromise as Promise<T>)
		) as T | undefined;
	assertExists(result);
	expect(result).to.be.an('object');
	for (const [key, valueOrAssertion] of Object.entries(expectations)) {
		if (typeof valueOrAssertion === 'function') {
			valueOrAssertion(
				expect(result).to.have.property(key),
				result[key as keyof typeof result],
			);
		} else if (
			typeof valueOrAssertion === 'object' &&
			valueOrAssertion != null
		) {
			expect(result).to.have.property(key).to.deep.equal(valueOrAssertion);
		} else {
			expect(result).to.have.property(key, valueOrAssertion);
		}
	}
	return result;
};

const validJwtProps = ['id', 'jwt_secret', 'authTime', 'iat', 'exp'].sort();

export function expectJwt(tokenOrJwt: string | AnyObject) {
	const decoded = (
		typeof tokenOrJwt === 'string'
			? jsonwebtoken.decode(tokenOrJwt)
			: tokenOrJwt
	) as RequiredField<TokenUserPayload, 'authTime'> & {
		iat: number;
		exp: number;
	};
	expect(decoded).to.have.property('id').that.is.a('number');
	expect(decoded).to.have.property('jwt_secret').that.is.a.string;
	expect(decoded.jwt_secret).to.be.a('string').that.has.length(32);
	expect(decoded).to.have.property('authTime').that.is.a('number');
	expect(decoded).to.have.property('iat').that.is.a('number');
	expect(decoded).to.have.property('exp').that.is.a('number');

	const decodedKeys = Object.keys(decoded).sort();
	expect(
		decodedKeys,
		'expect there are no unexpected keys in the JWT',
	).to.deep.equal(validJwtProps);

	return decoded;
}
