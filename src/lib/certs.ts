import * as jsonwebtoken from 'jsonwebtoken';
import {
	TOKEN_AUTH_CERT_ISSUER,
	TOKEN_AUTH_CERT_KEY,
	TOKEN_AUTH_CERT_KID,
	TOKEN_AUTH_CERT_PUB,
	TOKEN_AUTH_JWT_ALGO,
} from './config';
import { b64decode } from './utils';

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
): algo is typeof allowedAlgorithms[number] => allowedAlgorithms.includes(algo);

if (!isAllowedAlgorithm(TOKEN_AUTH_JWT_ALGO)) {
	throw new Error(`Invalid JWT algorithm: '${TOKEN_AUTH_JWT_ALGO}'`);
}

export const registryAuth: {
	algo: jsonwebtoken.SignOptions['algorithm'];
	issuer: jsonwebtoken.SignOptions['issuer'];
	key: jsonwebtoken.Secret;
	pub: jsonwebtoken.Secret;
	kid: string;
} = {
	algo: TOKEN_AUTH_JWT_ALGO,
	issuer: TOKEN_AUTH_CERT_ISSUER,
	key: b64decode(TOKEN_AUTH_CERT_KEY),
	pub: b64decode(TOKEN_AUTH_CERT_PUB),
	kid: b64decode(TOKEN_AUTH_CERT_KID),
};
