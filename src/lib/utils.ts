import * as _ from 'lodash';
import * as ipaddr from 'ipaddr.js';
import { Request } from 'express';

export const isValidInteger = (num: any): num is number => {
	const n = checkInt(num);
	return n !== false && n > 0;
};

export const checkInt = (num?: string): number | false => {
	if (num == null) {
		return false;
	}
	const n = _.parseInt(num, 10);
	if (_.isNaN(n)) {
		return false;
	}
	return n;
};

export const getIP = (req: Request): string | undefined =>
	req.ip ||
	(req as any)._remoteAddress ||
	(req.connection != null && req.connection.remoteAddress) ||
	undefined;

// Returns the IPv4 formatted address if possible, or undefined if not
export const getIPv4 = (req: Request): string | undefined => {
	try {
		const rawIp = getIP(req);
		if (rawIp == null) {
			return;
		}
		const ip = ipaddr.parse(rawIp);

		if (ip.kind() === 'ipv4') {
			return ip.toString();
		} else if (ip instanceof ipaddr.IPv6 && ip.isIPv4MappedAddress()) {
			return ip.toIPv4Address().toString();
		}
	} catch {}
};

export type EnvVarList = Array<{ name: string; value: string }>;

export const varListInsert = (varList: EnvVarList, obj: Dictionary<string>) => {
	varList.forEach(evar => {
		obj[evar.name] = evar.value;
	});
};

export const b64decode = (str: string): string =>
	Buffer.from(str, 'base64')
		.toString()
		.trim();
