#!/bin/bash
set -e

test_versions=''
test_files=''
extra_env=''
extra_args=''

while [[ $# -gt 0 ]]; do
	key=$1
	shift
	case $key in
		--long-stack)
			extra_env="${extra_env} --env BLUEBIRD_LONG_STACK_TRACES=1"
		;;
		--debug)
			extra_env="${extra_env} --env DEBUG=1"
		;;
		--profile)
			extra_args="${extra_args} --inspect-brk=0.0.0.0"
		;;
		--generate-config)
			echo "Generating config as $1"
			echo
			extra_env="${extra_env} --env GENERATE_CONFIG=$1"
			shift
		;;
		*)
			test_files="$test_files $key"
		;;
	esac
done

docker compose -f docker-compose.test.yml up --renew-anon-volumes --force-recreate --detach redis db loki 
docker compose -f docker-compose.test.yml up --no-recreate --detach sut-fast 
docker compose -f docker-compose.test.yml exec sut-fast npm rebuild

if [[ -z "$test_files" ]]; then
	echo "Running all tests"
else
	echo "Running tests:$test_files"
fi
if [[ -z "$test_versions" ]]; then
	echo "Running all versions"
else
	echo "Running versions:$test_versions"
fi

docker compose -f docker-compose.test.yml exec ${extra_env} --env TEST_VERSIONS="$test_versions" --env TEST_FILES="$test_files" sut-fast npm run mocha --bail ${extra_args}
