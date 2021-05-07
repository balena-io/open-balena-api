import type {
	AbstractSqlModel,
	AbstractSqlQuery,
	AndNode,
	BooleanTypeNodes,
	EqualsNode,
} from '@balena/abstract-sql-compiler';

export const addToModel = (
	abstractSql: AbstractSqlModel,
	addShims: boolean = true,
) => {
	if (addShims) {
		// FIXME: this is a shim for the `is web accessible` attribute on the device
		// resource. The core API has no support for "Device Public URLs".
		abstractSql.tables['device'].fields.push({
			fieldName: 'is web accessible',
			dataType: 'Boolean',
			// The cast is needed because AbstractSqlQuery cannot express a constant value.
			computed: ['Boolean', false] as AbstractSqlQuery,
		});
	}

	// FIXME: cloud has the notion of active/inactive devices via a field
	// on the device resource. Computing the overall status below depends
	// on whether the device is active but also on a few other statuses
	// (Ordered, Preparing, etc.) that make no sense for the core API.
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
		: [
				'Equals',
				['ReferencedField', 'device', 'is active'],
				['Boolean', false],
		  ];

	const isOverallOffline: AndNode = [
		'And',
		['Equals', ['ReferencedField', 'device', 'is online'], ['Boolean', false]],
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
		isOverallOffline,
		['NotExists', ['ReferencedField', 'device', 'last connectivity event']],
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
			'Case',
			[
				'When',
				[
					'Or',
					[
						'In',
						['ReferencedField', 'device', 'status'],
						['EmbeddedText', 'Ordered'],
						['EmbeddedText', 'Preparing'],
					],
					[
						'And',
						[
							'Equals',
							['ReferencedField', 'device', 'is online'],
							['Boolean', false],
						],
						[
							'Equals',
							['ReferencedField', 'device', 'status'],
							['EmbeddedText', 'Shipped'],
						],
					],
				],
				['ToLower', ['ReferencedField', 'device', 'status']],
			],
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
				[
					'Or',
					[
						'In',
						['ReferencedField', 'device', 'status'],
						['EmbeddedText', 'Ordered'],
						['EmbeddedText', 'Preparing'],
					],
					[
						'And',
						[
							'Equals',
							['ReferencedField', 'device', 'is online'],
							['Boolean', false],
						],
						[
							'Equals',
							['ReferencedField', 'device', 'status'],
							['EmbeddedText', 'Shipped'],
						],
					],
					isInactive,
				],
				// If the device is inactive or in an Ordered/Preparing/Shipped then we return null progress as we have no more info
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
