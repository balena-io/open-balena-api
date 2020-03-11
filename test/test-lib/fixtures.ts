import * as Bluebird from 'bluebird';
import * as _ from 'lodash';

type Fixtures = Dictionary<PromiseLike<Dictionary<PromiseLike<any>>>>;

const defaultFixtures: Fixtures = {};

export const setDefaultFixtures = (
	type: string,
	value: Dictionary<PromiseLike<any>>,
) => {
	defaultFixtures[type] = Promise.resolve(value);
};

export type FixtureData = Dictionary<Dictionary<any>>;

export const load = async (): Promise<FixtureData> => {
	const fixtures = { ...defaultFixtures };
	return Bluebird.props(_.mapValues(fixtures, fx => Bluebird.props(fx)));
};
