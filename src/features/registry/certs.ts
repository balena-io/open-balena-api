import type jsonwebtoken from 'jsonwebtoken';

import {
	TOKEN_AUTH_CERT_ISSUER,
	TOKEN_AUTH_CERT_KEY,
	TOKEN_AUTH_CERT_KID,
	TOKEN_AUTH_CERT_PUB,
	TOKEN_AUTH_JWT_ALGO,
} from '../../lib/config.js';
import { b64decode } from '../../lib/utils.js';

const allowedAlgorithms = [
	'HS256',
	'HS384',
	'HS512',
	'RS256',
	'RS384',
	'RS512',
	'ES256',
	'ES384',
	'ES512',
	'PS256',
	'PS384',
	'PS512',
] as const;
const isAllowedAlgorithm = (
	algo: any,
): algo is (typeof allowedAlgorithms)[number] =>
	allowedAlgorithms.includes(algo);

if (!isAllowedAlgorithm(TOKEN_AUTH_JWT_ALGO)) {
	throw new Error(`Invalid JWT algorithm: '${TOKEN_AUTH_JWT_ALGO}'`);
}

function pemToX5cEntry(pem: string) {
	const normalized = pem.replace(/\\n/g, '\n');
	const b64Body = normalized
		.replace(/-----BEGIN CERTIFICATE-----/g, '')
		.replace(/-----END CERTIFICATE-----/g, '')
		.replace(/\s+/g, '')
		.trim();
	return Buffer.from(b64Body, 'base64').toString('base64');
}

export const registryAuth: {
	algo: jsonwebtoken.SignOptions['algorithm'];
	issuer: jsonwebtoken.SignOptions['issuer'];
	key: jsonwebtoken.Secret;
	pub: jsonwebtoken.Secret;
	kid: string;
	x5c: string;
} = {
	algo: TOKEN_AUTH_JWT_ALGO,
	issuer: TOKEN_AUTH_CERT_ISSUER,
	key: b64decode(TOKEN_AUTH_CERT_KEY),
	pub: b64decode(TOKEN_AUTH_CERT_PUB),
	kid: b64decode(TOKEN_AUTH_CERT_KID),
	x5c: pemToX5cEntry(b64decode(TOKEN_AUTH_CERT_PUB).toString()),
};
