// Fill a missing property of redis clients that is documented but not typed
import type { RedisClient } from 'redis';

declare module 'redis' {
	interface RedisClient {
		should_buffer: boolean;
	}
}
