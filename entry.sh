#!/bin/bash

if [ "$PRODUCTION_MODE" == "true" ]; then
	exec node index.js
else
	exec ./node_modules/.bin/supervisor \
		--no-restart-on error \
		--extensions js,node,coffee,sbvr,json,sql,pegjs,ts \
		--watch src \
		--exec node index.js
fi
