import { b64decode } from './utils';
import {
	TOKEN_AUTH_JWT_ALGO,
	TOKEN_AUTH_CERT_ISSUER,
	TOKEN_AUTH_CERT_KEY,
	TOKEN_AUTH_CERT_PUB,
	TOKEN_AUTH_CERT_KID,
} from './config';

export const registryAuth = {
	algo: TOKEN_AUTH_JWT_ALGO,
	issuer: TOKEN_AUTH_CERT_ISSUER,
	key: b64decode(TOKEN_AUTH_CERT_KEY),
	pub: b64decode(TOKEN_AUTH_CERT_PUB),
	kid: b64decode(TOKEN_AUTH_CERT_KID),
};
