import { hooks, errors } from '@balena/pinejs';

const { BadRequestError } = errors;

const checkDependentApplication: hooks.Hooks['POSTPARSE'] = async ({
	request,
	api,
}) => {
	const dependsOnApplicationId = request.values.depends_on__application;
	if (dependsOnApplicationId != null) {
		const dependsOnApplication = await api.get({
			resource: 'application',
			id: dependsOnApplicationId,
			options: {
				$select: ['id'],
			},
		});
		if (dependsOnApplication == null) {
			throw new BadRequestError('Invalid application to depend upon');
		}
	}
};

hooks.addPureHook('POST', 'resin', 'application', {
	POSTPARSE: checkDependentApplication,
});

hooks.addPureHook('PUT', 'resin', 'application', {
	POSTPARSE: checkDependentApplication,
});

hooks.addPureHook('PATCH', 'resin', 'application', {
	PRERUN: checkDependentApplication,
});
