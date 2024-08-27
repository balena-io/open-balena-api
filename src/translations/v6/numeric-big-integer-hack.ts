import SbvrTypes from '@balena/sbvr-types';
import type * as TypeUtils from '@balena/sbvr-types/out/type-utils.js';

// We use the TsTypes as the type name here so that it doesn't conflict later
// when we augment the @balena/sbvr-types Types type.
type TsTypes = TypeUtils.TsTypes<number, number>;
export { TsTypes as Types };
export type DbWriteType = number;

// Augmenting is necessary so that the TS v6-model.ts compiles properly
declare module '@balena/sbvr-types' {
	export interface Types {
		'Numeric Big Integer': TsTypes;
	}
}

// @ts-expect-error we are augmenting SbvrTypes w/ Numeric Big Integer
SbvrTypes.default['Numeric Big Integer'] = {
	...SbvrTypes.default['Big Integer'],

	fetchProcessing(data) {
		const processedData =
			SbvrTypes.default['Big Integer'].fetchProcessing(data);
		if (processedData == null) {
			return processedData;
		}
		return parseInt(processedData, 10);
	},

	validate: SbvrTypes.default.Integer.validate,
} satisfies TypeUtils.SbvrType<TsTypes['Read'], TsTypes['Write'], DbWriteType>;
