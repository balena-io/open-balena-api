import type {
	AbstractSqlModel,
	AbstractSqlQuery,
	AndNode,
	BooleanTypeNodes,
	EqualsNode,
} from '@balena/abstract-sql-compiler';

export const addToModel = (
	abstractSql: AbstractSqlModel,
	/* @deprecated */
	addShims?: boolean,
) => {
	const deviceFieldSet = new Set(
		abstractSql.tables['device'].fields.map((f) => f.fieldName),
	);
	if (addShims !== false && !deviceFieldSet.has('is web accessible')) {
		// FIXME: The core API has no support for "Device Public URLs",
		// but w/o this shim some CLI commands fail since they do select it,
		// Eg: A mechanism that silently unknown selected fields on versioned models
		// would allow us to drop this.
		abstractSql.tables['device'].fields.push({
			fieldName: 'is web accessible',
			dataType: 'Boolean',
			// The cast is needed because AbstractSqlQuery cannot express a constant value.
			computed: ['Boolean', false] as AbstractSqlQuery,
		});
	}

	if (addShims !== false && !deviceFieldSet.has('is frozen')) {
		// Even though the core API does not have device freezing, we have to define
		// a shimmed version so that we can refer to it in the device permissions.
		abstractSql.tables['device'].fields.push({
			fieldName: 'is frozen',
			dataType: 'Boolean',
			// The cast is needed because AbstractSqlQuery cannot express a constant value.
			computed: ['Boolean', false] as AbstractSqlQuery,
		});
	}

	// The Cloud API has the notion of active/inactive devices via a field
	// on the device resource. Computing the overall status below depends
	// on whether the device 'is active'.
	//
	// We must somehow expose the overall status/progress attributes on the
	// model and we could contrive a way for the cloud to inject the extra
	// cases, but that would quickly become overly complex because the order
	// of cases matters. We'd never be able to cleanly make the core API
	// agnostic to the cloud.
	//
	// Therefore, we opted for using the 'is active' field when it's part of
	// the model, otherwise we use a dummy `false` value everywhere that field
	// is referenced. This approach can also be used in core API
	// translations in a consistent way.
	const isInactive: BooleanTypeNodes =
		addShims !== false && !deviceFieldSet.has('is active')
			? ['Boolean', false]
			: ['Not', ['ReferencedField', 'device', 'is active']];

	const isOverallOffline: AndNode = [
		'And',
		['Not', ['ReferencedField', 'device', 'is online']],
		[
			'In',
			['ReferencedField', 'device', 'api heartbeat state'],
			['EmbeddedText', 'offline'],
			['EmbeddedText', 'unknown'],
		],
	];

	// VPN not connected and supervisor didn't yet reach the API,
	// so it's still provisioning.
	const isPreProvisioning: AndNode = [
		'And',
		['Not', ['ReferencedField', 'device', 'is online']],
		['NotExists', ['ReferencedField', 'device', 'last connectivity event']],
		[
			'Equals',
			['ReferencedField', 'device', 'api heartbeat state'],
			['EmbeddedText', 'unknown'],
		],
	];

	const isPostProvisioning: EqualsNode = [
		'Equals',
		['ReferencedField', 'device', 'provisioning state'],
		['EmbeddedText', 'Post-Provisioning'],
	];

	abstractSql.tables['device'].fields.push({
		fieldName: 'overall status',
		dataType: 'Short Text',
		computed: [
			// TODO: should use `is managed by-service instance` with timeout for informing online/offline
			'Case',
			['When', isInactive, ['EmbeddedText', 'inactive']],
			['When', isPostProvisioning, ['EmbeddedText', 'post-provisioning']],
			['When', isPreProvisioning, ['EmbeddedText', 'configuring']],
			['When', isOverallOffline, ['EmbeddedText', 'offline']],
			[
				'When',
				[
					'And',
					['Exists', ['ReferencedField', 'device', 'download progress']],
					[
						'Equals',
						['ReferencedField', 'device', 'status'],
						['EmbeddedText', 'Downloading'],
					],
				],
				['EmbeddedText', 'updating'],
			],
			[
				'When',
				['Exists', ['ReferencedField', 'device', 'provisioning progress']],
				['EmbeddedText', 'configuring'],
			],
			[
				'When',
				[
					'Exists',
					[
						'SelectQuery',
						['Select', []],
						['From', ['Table', 'image install']],
						[
							'Where',
							[
								'And',
								[
									'Equals',
									['ReferencedField', 'image install', 'device'],
									['ReferencedField', 'device', 'id'],
								],
								[
									'Exists',
									['ReferencedField', 'image install', 'download progress'],
								],
								[
									'Equals',
									['ReferencedField', 'image install', 'status'],
									['EmbeddedText', 'Downloading'],
								],
							],
						],
					],
				],
				['EmbeddedText', 'updating'],
			],
			['Else', ['EmbeddedText', 'idle']],
		],
	});

	abstractSql.tables['device'].fields.push({
		fieldName: 'overall progress',
		dataType: 'Integer',
		computed: [
			'Case',
			[
				'When',
				isInactive,
				// If the device is inactive then we return null progress as we have no more info
				['Null'],
			],
			[
				'When',
				isPostProvisioning,
				// If the device is in a post provisioning state then we return the provisioning progress
				['ReferencedField', 'device', 'provisioning progress'],
			],
			[
				'When',
				isPreProvisioning,
				// If the device is offline and has always been offline we return the provisioning progress
				['ReferencedField', 'device', 'provisioning progress'],
			],
			[
				'When',
				isOverallOffline,
				// Otherwise if the device is offline but has previously been online we return no info
				['Null'],
			],
			[
				'When',
				[
					'And',
					['Exists', ['ReferencedField', 'device', 'download progress']],
					[
						'Equals',
						['ReferencedField', 'device', 'status'],
						['EmbeddedText', 'Downloading'],
					],
				],
				// If the device itself is downloading then we return its download progress in isolation (ignoring image installs)
				['ReferencedField', 'device', 'download progress'],
			],
			[
				'When',
				['Exists', ['ReferencedField', 'device', 'provisioning progress']],
				['ReferencedField', 'device', 'provisioning progress'],
			],
			[
				// If there are any image installs in the 'downloading' status then we return the average download progress of all image installs
				// that are either for the current release or in the 'downloading' status
				'When',
				[
					'Exists',
					[
						'SelectQuery',
						['Select', []],
						['From', ['Table', 'image install']],
						[
							'Where',
							[
								'And',
								[
									'Equals',
									['ReferencedField', 'image install', 'device'],
									['ReferencedField', 'device', 'id'],
								],
								[
									'Exists',
									['ReferencedField', 'image install', 'download progress'],
								],
								[
									'Equals',
									['ReferencedField', 'image install', 'status'],
									['EmbeddedText', 'Downloading'],
								],
							],
						],
					],
				],
				[
					'SelectQuery',
					[
						'Select',
						[
							[
								// W/o the Cast, Round(Average()) will return values of the Numeric DB type,
								// and node-pg will convert that to a string, since it can't represent it
								// with the same accuracy otherwise (might have too many decimals or be greater than a big int).
								'Cast',
								[
									'Round',
									[
										'Average',
										[
											'Coalesce',
											['ReferencedField', 'image install', 'download progress'],
											['Number', 100],
										],
									],
								],
								'Integer',
							],
						],
					],
					['From', ['Table', 'image install']],
					[
						'Where',
						[
							'And',
							[
								'Equals',
								['ReferencedField', 'image install', 'device'],
								['ReferencedField', 'device', 'id'],
							],
							[
								'NotEquals',
								['ReferencedField', 'image install', 'status'],
								['EmbeddedText', 'deleted'],
							],
							[
								'Or',
								[
									'Equals',
									['ReferencedField', 'image install', 'status'],
									['EmbeddedText', 'Downloading'],
								],
								[
									'Equals',
									[
										'ReferencedField',
										'image install',
										'is provided by-release',
									],
									[
										'Coalesce',
										['ReferencedField', 'device', 'should be running-release'],
										[
											'SelectQuery',
											[
												'Select',
												[
													[
														'ReferencedField',
														'application',
														'should be running-release',
													],
												],
											],
											['From', ['Table', 'application']],
											[
												'Where',
												[
													'Equals',
													[
														'ReferencedField',
														'device',
														'belongs to-application',
													],
													['ReferencedField', 'application', 'id'],
												],
											],
										],
									],
								],
							],
						],
					],
				],
			],
			[
				// And if we haven't found any download progress yet we return null
				'Else',
				['Null'],
			],
		],
	});
};
