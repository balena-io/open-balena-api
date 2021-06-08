import * as _ from 'lodash';
import { PineTest } from 'pinejs-client-supertest';
import { app } from '../../init';
import { version } from './versions';

export const pineTest = new PineTest({ apiPrefix: `${version}/` }, { app });
