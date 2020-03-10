import * as balenaToken from 'resin-token';
import * as temp from 'temp';

export const parse = balenaToken({
	dataDirectory: temp.track().mkdirSync(),
}).parse;
