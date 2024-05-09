import type {
	AbstractSqlModel,
	AbstractSqlQuery,
	AndNode,
	BooleanTypeNodes,
	EqualsNode,
	OrNode,
} from '@balena/abstract-sql-compiler';

export const addToModel = (
	abstractSql: AbstractSqlModel,
	addShims: boolean = true,
) => {
	if (addShims) {
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

		// Even though the core API does not have device freezing, we have to define
		// a shimmed version so that we can refer to it in the device permissions.
		abstractSql.tables['device'].fields.push({
			fieldName: 'is frozen',
			dataType: 'Boolean',
			// The cast is needed because AbstractSqlQuery cannot express a constant value.
			computed: ['Boolean', false] as AbstractSqlQuery,
		});
	}

	// FIXME: cloud has the notion of active/inactive devices via a field
	// on the device resource. Computing the overall status below depends
	// on whether the device is active.
	//
	// We must somehow expose the overall status/progress attributes on the
	// model and we could contrive a way for the cloud to inject the extra
	// cases, but that would quickly become overly complex because the order
	// of cases matters. We'd never be able to cleanly make the core API
	// agnostic to the cloud.
	//
	// Therefore, I opted for the most straightforward way, which is to switch
	// the computation based on a flag. When `addShims` is true (the default),
	// it'll generate a dummy case (the equivalent of 1 == 2, which is always
	// false), otherwise it'll generate a case that looks into the actual model
	// field.
	const isInactive: BooleanTypeNodes = addShims
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
	// This check does not double check heartbeat state as it is already checked from isOverallOffline which runs before
	const hasPartialConnectivity: OrNode = [
		'Or',
		[
			'And',
			['Equals', ['ReferencedField', 'device', 'is online'], ['Boolean', true]],
			[
				'NotEquals',
				['ReferencedField', 'device', 'api heartbeat state'],
				['EmbeddedText', 'online'],
			],
		],
		[
			'And',
			[
				'Equals',
				['ReferencedField', 'device', 'is online'],
				['Boolean', false],
			],
			[
				'In',
				['ReferencedField', 'device', 'api heartbeat state'],
				['EmbeddedText', 'online'],
				['EmbeddedText', 'timeout'],
			],
			[
				'NotEquals',
				[
					'Coalesce',
					[
						'SelectQuery',
						[
							'Select',
							[['ReferencedField', 'device config variable', 'value']],
						],
						['From', ['Table', 'device config variable']],
						[
							'Where',
							[
								'And',
								[
									'Equals',
									['ReferencedField', 'device config variable', 'device'],
									['ReferencedField', 'device', 'id'],
								],
								[
									'Equals',
									['ReferencedField', 'device config variable', 'name'],
									['EmbeddedText', 'RESIN_SUPERVISOR_VPN_CONTROL'],
								],
							],
						],
					],
					[
						'SelectQuery',
						[
							'Select',
							[['ReferencedField', 'application config variable', 'value']],
						],
						['From', ['Table', 'application config variable']],
						[
							'Where',
							[
								'And',
								[
									'Equals',
									[
										'ReferencedField',
										'application config variable',
										'application',
									],
									['ReferencedField', 'device', 'belongs to-application'],
								],
								[
									'Equals',
									['ReferencedField', 'application config variable', 'name'],
									['EmbeddedText', 'RESIN_SUPERVISOR_VPN_CONTROL'],
								],
							],
						],
					],
					// Adding a COALESCE default value to avoid the need for NotEquals to compare 'false' with NULL
					['EmbeddedText', 'not set'],
				],
				['EmbeddedText', 'false'],
			],
		],
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
			['When', isOverallOffline, ['EmbeddedText', 'disconnected']],
			[
				'When',
				[
					'And',
					[
						'In',
						['ReferencedField', 'device', 'api heartbeat state'],
						['EmbeddedText', 'online'],
						['EmbeddedText', 'timeout'],
					],
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
					'And',
					[
						'In',
						['ReferencedField', 'device', 'api heartbeat state'],
						['EmbeddedText', 'online'],
						['EmbeddedText', 'timeout'],
					],
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
				],
				['EmbeddedText', 'updating'],
			],
			[
				'When',
				hasPartialConnectivity,
				['EmbeddedText', 'reduced-functionality'],
			],
			['Else', ['EmbeddedText', 'operational']],
		],
	});

	console.log(abstractSql.tables['device']);

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
