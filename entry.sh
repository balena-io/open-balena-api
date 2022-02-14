#!/bin/bash

# Run confd --onetime
confd -onetime -confdir /usr/src/app/config/confd -backend env

# Source env file
set -a
. /usr/src/app/config/env
set +a

# Launch node app

if [ "$PRODUCTION_MODE" == "true" ]; then
	node index.js
else
	./node_modules/.bin/supervisor \
		--no-restart-on error \
		--extensions js,node,coffee,sbvr,json,sql,pegjs,ts \
		--watch src \
		--exec node index.js
fi
