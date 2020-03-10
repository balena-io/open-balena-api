import * as Bluebird from 'bluebird';
import * as resinToken from 'resin-token';
import * as temp from 'temp';

export interface ParsedToken {
	[index: string]: any;
}

export const parse: (token: string) => Bluebird<ParsedToken> = resinToken({
	dataDirectory: temp.track().mkdirSync(),
}).parse;
