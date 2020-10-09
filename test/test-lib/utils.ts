import * as Bluebird from 'bluebird';
import { exec } from 'child_process';
import * as util from 'util';

export const execAsync = Bluebird.method(util.promisify(exec));
