cp src/balena-model.ts src/balena-model.ts.bak
npm run _generate-model-types
if ! diff -q src/balena-model.ts src/balena-model.ts.bak > /dev/null; then
	echo 'Types were out of date, please commit the updated version if running locally, otherwise use `npm run generate-model-types` to regenerate them locally'
	echo "$(diff src/balena-model.ts src/balena-model.ts.bak | head -10)"
	rm src/balena-model.ts.bak
	exit 1
fi;

rm src/balena-model.ts.bak
