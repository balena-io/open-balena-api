#!/bin/bash

if [ "$PRODUCTION_MODE" == "true" ]; then
	exec node --enable-source-maps --loader @swc-node/register/esm-register index.js
else
	exec node_modules/.bin/supervisor \
		--no-restart-on error \
		--extensions js,node,coffee,sbvr,json,sql,pegjs,ts \
		--watch src \
		-- --enable-source-maps --loader @swc-node/register/esm-register index.js
fi
