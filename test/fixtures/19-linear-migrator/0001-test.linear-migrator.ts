import { Migrator } from '@balena/pinejs';

const transformationFn = (async (tx: any) => {
	const rowsPerStep = 2;
	const sourceTable = 'users';
	const destinationTable = 'users';
	const sourceField = 'gender id';
	const destinationField = 'gender';

	const sql = `\
UPDATE ${destinationTable}
SET "${sourceTable}"."${sourceField}" = "${destinationTable}"."${destinationField}"
WHERE id IN (SELECT id
			FROM ${sourceTable}
			WHERE "${sourceTable}"."${sourceField}" != "${destinationTable}"."${destinationField}"
			LIMIT ${rowsPerStep}
			);
`;

	await tx.executeSql(sql);
}) as Migrator.MigrationFn;

export const linearMigrator = {
	delayMS: 200,
	transformationFn,
};
