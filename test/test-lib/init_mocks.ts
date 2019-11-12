import('./aws-mock');

// override the interval used to emit the queue stats event...
import { DeviceOnlineStateManager } from '../../src/lib/device-online-state';
(DeviceOnlineStateManager as any)['QUEUE_STATS_INTERVAL_MSEC'] = 1000;

export {};
