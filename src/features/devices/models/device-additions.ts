import type {
	AbstractSqlModel,
	AbstractSqlQuery,
	AndNode,
	BooleanTypeNodes,
	EqualsNode,
	NotEqualsNode,
	OrNode,
} from '@balena/abstract-sql-compiler';

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
export const isInactiveFn = (isActiveNotExist: boolean): BooleanTypeNodes =>
	isActiveNotExist
		? ['Boolean', false]
		: ['Not', ['ReferencedField', 'device', 'is active']];

export const isOverallOffline: AndNode = [
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
export const isPreProvisioning: AndNode = [
	'And',
	['Not', ['ReferencedField', 'device', 'is online']],
	['NotExists', ['ReferencedField', 'device', 'last connectivity event']],
	[
		'Equals',
		['ReferencedField', 'device', 'api heartbeat state'],
		['EmbeddedText', 'unknown'],
	],
];

export const isPostProvisioning: EqualsNode = [
	'Equals',
	['ReferencedField', 'device', 'provisioning state'],
	['EmbeddedText', 'Post-Provisioning'],
];

const isVpnEnabled: NotEqualsNode = [
	'NotEquals',
	[
		'Coalesce',
		[
			'SelectQuery',
			['Select', [['ReferencedField', 'dcv', 'value']]],
			['From', ['Alias', ['Table', 'device config variable'], 'dcv']],
			[
				'Where',
				[
					'And',
					[
						'Equals',
						['ReferencedField', 'dcv', 'device'],
						['ReferencedField', 'device', 'id'],
					],
					[
						'In',
						['ReferencedField', 'dcv', 'name'],
						['EmbeddedText', 'BALENA_SUPERVISOR_VPN_CONTROL'],
						['EmbeddedText', 'RESIN_SUPERVISOR_VPN_CONTROL'],
					],
				],
			],
			// Prefer the `BALENA_` version when both are set, as the Supervisor does.
			['OrderBy', ['ASC', ['ReferencedField', 'dcv', 'name']]],
			['Limit', ['Number', 1]],
		],
		[
			'SelectQuery',
			['Select', [['ReferencedField', 'acv', 'value']]],
			['From', ['Alias', ['Table', 'application config variable'], 'acv']],
			[
				'Where',
				[
					'And',
					[
						'Equals',
						['ReferencedField', 'acv', 'application'],
						['ReferencedField', 'device', 'belongs to-application'],
					],
					[
						'In',
						['ReferencedField', 'acv', 'name'],
						['EmbeddedText', 'BALENA_SUPERVISOR_VPN_CONTROL'],
						['EmbeddedText', 'RESIN_SUPERVISOR_VPN_CONTROL'],
					],
				],
			],
			// Prefer the `BALENA_` version when both are set, as the Supervisor does.
			['OrderBy', ['ASC', ['ReferencedField', 'acv', 'name']]],
			['Limit', ['Number', 1]],
		],
		// Adding a COALESCE default value to avoid the need for NotEquals to compare 'false' with NULL
		['EmbeddedText', 'not set'],
	],
	['EmbeddedText', 'false'],
];
// This check does not double check heartbeat state as it is already checked from isOverallOffline which runs before
const hasPartialConnectivity: OrNode = [
	'Or',
	[
		'Equals',
		['ReferencedField', 'device', 'api heartbeat state'],
		['EmbeddedText', 'timeout'],
	],
	[
		'And',
		['ReferencedField', 'device', 'is online'],
		[
			'NotEquals',
			['ReferencedField', 'device', 'api heartbeat state'],
			['EmbeddedText', 'online'],
		],
	],
	[
		'And',
		['Not', ['ReferencedField', 'device', 'is online']],
		[
			'Equals',
			['ReferencedField', 'device', 'api heartbeat state'],
			['EmbeddedText', 'online'],
		],
		isVpnEnabled,
	],
];

export const addToModel = (abstractSql: AbstractSqlModel) => {
	const deviceFieldSet = new Set(
		abstractSql.tables['device'].fields.map((f) => f.fieldName),
	);
	if (!deviceFieldSet.has('is web accessible')) {
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

	if (!deviceFieldSet.has('is frozen')) {
		// Even though the core API does not have device freezing, we have to define
		// a shimmed version so that we can refer to it in the device permissions.
		abstractSql.tables['device'].fields.push({
			fieldName: 'is frozen',
			dataType: 'Boolean',
			// The cast is needed because AbstractSqlQuery cannot express a constant value.
			computed: ['Boolean', false] as AbstractSqlQuery,
		});
	}

	const isInactive = isInactiveFn(!deviceFieldSet.has('is active'));

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
							['From', ['Alias', ['Table', 'image install'], 'ii']],
							[
								'Where',
								[
									'And',
									[
										'Equals',
										['ReferencedField', 'ii', 'device'],
										['ReferencedField', 'device', 'id'],
									],
									['Exists', ['ReferencedField', 'ii', 'download progress']],
									[
										'Equals',
										['ReferencedField', 'ii', 'status'],
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
						['From', ['Alias', ['Table', 'image install'], 'ii']],
						[
							'Where',
							[
								'And',
								[
									'Equals',
									['ReferencedField', 'ii', 'device'],
									['ReferencedField', 'device', 'id'],
								],
								['Exists', ['ReferencedField', 'ii', 'download progress']],
								[
									'Equals',
									['ReferencedField', 'ii', 'status'],
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
											['ReferencedField', 'ii', 'download progress'],
											['Number', 100],
										],
									],
								],
								'Integer',
							],
						],
					],
					['From', ['Alias', ['Table', 'image install'], 'ii']],
					[
						'Where',
						[
							'And',
							[
								'Equals',
								['ReferencedField', 'ii', 'device'],
								['ReferencedField', 'device', 'id'],
							],
							[
								'NotEquals',
								['ReferencedField', 'ii', 'status'],
								['EmbeddedText', 'deleted'],
							],
							[
								'Or',
								[
									'Equals',
									['ReferencedField', 'ii', 'status'],
									['EmbeddedText', 'Downloading'],
								],
								[
									'Equals',
									['ReferencedField', 'ii', 'is provided by-release'],
									[
										'Coalesce',
										['ReferencedField', 'device', 'is pinned on-release'],
										[
											'SelectQuery',
											[
												'Select',
												[['ReferencedField', 'a', 'should be running-release']],
											],
											['From', ['Alias', ['Table', 'application'], 'a']],
											[
												'Where',
												[
													'Equals',
													[
														'ReferencedField',
														'device',
														'belongs to-application',
													],
													['ReferencedField', 'a', 'id'],
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

	const deviceShouldBeRunningReleaseField = abstractSql.tables[
		'device'
	].fields.find((f) => f.fieldName === 'should be running-release');
	if (deviceShouldBeRunningReleaseField == null) {
		throw new Error(
			"Could not find 'should be running-release' field in device model",
		);
	}
	deviceShouldBeRunningReleaseField.computed = [
		'Case',
		[
			'When',
			['Exists', ['ReferencedField', 'device', 'is pinned on-release']],
			['ReferencedField', 'device', 'is pinned on-release'],
		],
		[
			'Else',
			[
				'SelectQuery',
				['Select', [['ReferencedField', 'a', 'should be running-release']]],
				['From', ['Alias', ['Table', 'application'], 'a']],
				[
					'Where',
					[
						'Equals',
						['ReferencedField', 'a', 'id'],
						['ReferencedField', 'device', 'belongs to-application'],
					],
				],
			],
		],
	];
};
