import type {
	AbstractSqlModel,
	AndNode,
	OrNode,
	BooleanTypeNodes,
	EqualsNode,
} from '@balena/abstract-sql-compiler';

export const addToModel = (abstractSql: AbstractSqlModel) => {
	const isInactive: BooleanTypeNodes = [
		'Not',
		['ReferencedField', 'device', 'is active'],
	];

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

	const isReducedFunctionality: OrNode = [
		'Or',
		[
			'And',
			['Equals', ['ReferencedField', 'device', 'is online'], ['Boolean', true]],
			[
				'In',
				['ReferencedField', 'device', 'api heartbeat state'],
				['EmbeddedText', 'timeout'],
				['EmbeddedText', 'offline'],
				['EmbeddedText', 'unknown'],
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
			[
				'Not',
				[
					'Exists',
					[
						'SelectQuery',
						['Select', []],
						['From', ['Table', 'device config variable']],
						[
							'Where',
							[
								'And',
								[
									'Equals',
									['ReferencedField', 'device config variable', 'name'],
									['EmbeddedText', 'RESIN_SUPERVISOR_VPN_CONTROL'],
								],
								[
									'GreaterThan',
									['ReferencedField', 'device config variable', 'value'],
									['Number', 0],
								],
							],
						],
					],
				],
			],
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
			['When', isOverallOffline, ['EmbeddedText', 'disconnected']],
			[
				'When',
				isReducedFunctionality,
				['EmbeddedText', 'reduced-functionality'],
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
