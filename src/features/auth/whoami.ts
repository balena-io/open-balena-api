import type { RequestHandler } from 'express';

import { sbvrUtils, permissions, errors } from '@balena/pinejs';

import { getUser } from '../../infra/auth/auth.js';
import {
	captureException,
	handleHttpErrors,
	ThisShouldNeverHappenError,
} from '../../infra/error-handling/index.js';

import type { User, Application, Device, Actor } from '../../balena-model.js';

const { api } = sbvrUtils;

type ExpandedActor =
	| {
			id: number;
			is_of__user: [Pick<User['Read'], 'id' | 'username' | 'email'>];
			is_of__application: [];
			is_of__device: [];
	  }
	| {
			id: number;
			is_of__user: [];
			is_of__application: [Pick<Application['Read'], 'id' | 'slug'>];
			is_of__device: [];
	  }
	| {
			id: number;
			is_of__user: [];
			is_of__application: [];
			is_of__device: [Pick<Device['Read'], 'id' | 'uuid'>];
	  };

type ActorResponse =
	| {
			id: number;
			actorType: 'user';
			actorTypeId: number;
			username: string;
			email: string | null;
	  }
	| {
			id: number;
			actorType: 'application';
			actorTypeId: number;
			slug: string;
	  }
	| {
			id: number;
			actorType: 'device';
			actorTypeId: number;
			uuid: string;
	  };

export const whoami: RequestHandler = async (req, res) => {
	try {
		const userInfo = await sbvrUtils.db.readTransaction(
			async (
				tx,
			): Promise<
				Pick<User['Read'], 'id'> &
					Partial<Pick<User['Read'], 'username' | 'email'>>
			> => {
				const user = await getUser(req, tx, true);
				const [userWithUsername] = await api.resin.get({
					resource: 'user',
					passthrough: { req, tx },
					options: {
						$select: ['id', 'username'],
						$filter: { actor: user.actor },
					},
				});

				if (userWithUsername == null) {
					// If we can't retrieve the user, then this request might be from
					// a scoped api key which doesn't have access to the user resource
					// and we should just continue with whatever was provided from the `getUser` call above.
					return user;
				}

				const userWithEmail = await api.resin.get({
					resource: 'user',
					passthrough: { req: permissions.root, tx },
					id: userWithUsername.id,
					options: {
						$select: 'email',
					},
				});

				return {
					...userWithUsername,
					...userWithEmail,
				};
			},
		);
		res.json({
			id: userInfo.id,
			username: userInfo.username,
			email: userInfo.email,
		});
	} catch (err) {
		if (handleHttpErrors(req, res, err)) {
			return;
		}
		captureException(err, 'Error while getting user info');
		res.status(500).end();
	}
};

export const actorWhoami: RequestHandler = async (req, res) => {
	try {
		const actorInfo = await sbvrUtils.db.readTransaction(async (tx) => {
			// If this is a user key/token we must validate this is a key that
			// has permissions for reading username/email
			if (req.user?.actor) {
				const [userWithId] = await api.resin.get({
					resource: 'user',
					passthrough: { req, tx },
					options: {
						$top: 1,
						$select: 'id',
						$filter: {
							actor: req.user?.actor,
						},
					},
				});

				if (userWithId == null) {
					throw new errors.UnauthorizedError();
				}
			}

			const actorId = req.apiKey?.actor ?? req.user?.actor;

			if (actorId == null) {
				throw new errors.UnauthorizedError(
					'Request API Key or Token has no associated actor',
				);
			}

			return await api.resin.get({
				resource: 'actor',
				passthrough: { req: permissions.root, tx },
				id: actorId,
				options: {
					$select: ['id'],
					$expand: {
						is_of__user: {
							$select: ['id', 'username', 'email'],
						},
						is_of__application: {
							$select: ['id', 'slug'],
						},
						is_of__device: {
							$select: ['id', 'uuid'],
						},
					},
				},
			} as const);
		});
		validateRawActorInfo(actorInfo);
		res.json(formatActorInfo(actorInfo));
	} catch (err) {
		if (handleHttpErrors(req, res, err)) {
			return;
		}
		captureException(err, 'Error while getting actor info');
		res.status(500).end();
	}
};

const formatActorInfo = (rawActorInfo: ExpandedActor): ActorResponse => {
	if (rawActorInfo.is_of__user.length === 1) {
		return {
			id: rawActorInfo.id,
			actorType: 'user',
			actorTypeId: rawActorInfo.is_of__user[0].id,
			username: rawActorInfo.is_of__user[0].username,
			email: rawActorInfo.is_of__user[0].email,
		};
	}

	if (rawActorInfo.is_of__application.length === 1) {
		return {
			id: rawActorInfo.id,
			actorType: 'application',
			actorTypeId: rawActorInfo.is_of__application[0].id,
			slug: rawActorInfo.is_of__application[0].slug,
		};
	}

	if (rawActorInfo.is_of__device.length === 1) {
		return {
			id: rawActorInfo.id,
			actorType: 'device',
			actorTypeId: rawActorInfo.is_of__device[0].id,
			uuid: rawActorInfo.is_of__device[0].uuid,
		};
	}

	throw ThisShouldNeverHappenError(
		`Found ${rawActorInfo.id} associated with none or more than one resource`,
	);
};

function validateRawActorInfo(
	rawActorInfo:
		| {
				id: Actor['Read']['id'];
				is_of__user: Array<Pick<User['Read'], 'id' | 'username' | 'email'>>;
				is_of__application: Array<Pick<Application['Read'], 'id' | 'slug'>>;
				is_of__device: Array<Pick<Device['Read'], 'id' | 'uuid'>>;
		  }
		| undefined,
): asserts rawActorInfo is ExpandedActor {
	if (rawActorInfo == null) {
		throw new errors.UnauthorizedError(`Actor not found`);
	}

	const amountAssociatedResources =
		rawActorInfo.is_of__user.length +
		rawActorInfo.is_of__application.length +
		rawActorInfo.is_of__device.length;

	if (amountAssociatedResources > 1) {
		throw ThisShouldNeverHappenError(
			`Found ${rawActorInfo.id} associated with more than one resource`,
		);
	}

	if (amountAssociatedResources < 1) {
		throw new errors.UnauthorizedError(
			`Actor ${rawActorInfo.id} is not associated to any resource`,
		);
	}
}
