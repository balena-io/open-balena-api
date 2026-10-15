import type { Application } from 'express';
import {
	createValidatedRequestHandler,
	z,
} from '../../infra/validation/index.js';

export const DEPENDENCY_TRACK_NOTIFICATION_ROUTE =
	'/sbom/v1/dependency-track/notification';

/**
 * Dependency-Track wraps every outbound webhook in a `notification` envelope.
 * The shape of the payload below it varies per notification group, and the
 * templates producing it are editable from the UI, so only the envelope is
 * described here and everything else is carried through untouched.
 */
const dependencyTrackNotificationSchema = z.object({
	notification: z.looseObject({
		group: z.string(),
		level: z.string(),
		scope: z.string(),
		title: z.string().optional(),
		content: z.string().optional(),
		timestamp: z.string().optional(),
	}),
});

export type DependencyTrackNotification = z.infer<
	typeof dependencyTrackNotificationSchema
>;

// Bounded, so that a chatty sender cannot grow this without limit.
const MAX_RECORDED_NOTIFICATIONS = 100;
const receivedNotifications: DependencyTrackNotification[] = [];

export const getReceivedNotifications =
	(): readonly DependencyTrackNotification[] => receivedNotifications;

export const clearReceivedNotifications = () => {
	receivedNotifications.length = 0;
};

export const setup = (app: Application) => {
	// A mock receiver: it records deliveries so tests can assert that
	// Dependency-Track reached the api, and does nothing else with them.
	//
	// It is deliberately unauthenticated, which is only acceptable because it is
	// never mounted outside a test deployment. On a public api host this would
	// let anyone post forged vulnerability notifications, so the guard below is
	// load bearing — a real receiver needs authentication before it can ship.
	if (process.env.DEPLOYMENT !== 'TEST') {
		return;
	}

	app.post(
		DEPENDENCY_TRACK_NOTIFICATION_ROUTE,
		createValidatedRequestHandler(
			{ body: dependencyTrackNotificationSchema },
			(req, res) => {
				receivedNotifications.push(req.body);
				if (receivedNotifications.length > MAX_RECORDED_NOTIFICATIONS) {
					receivedNotifications.shift();
				}
				res.status(204).end();
			},
		),
	);
};
