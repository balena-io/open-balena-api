FROM balena/open-balena-base:v22.1.3-s6-overlay@sha256:bb0896a9014ed5d09dbf2318bd94a9f0b2c7a8283e1516fcd93f70e74f07e400 AS runtime

EXPOSE 80

# Defaults for vars read directly by libuv and pinejs; the runtime env overrides them
ENV UV_THREADPOOL_SIZE=128
ENV PG_SCHEMA=public
ENV TRANSACTION_TIMEOUT_MS=30000

COPY package.json package-lock.json /usr/src/app/
RUN HUSKY=0 npm ci --omit=dev && npm cache clean --force

COPY . /usr/src/app

RUN npx tsc --noEmit --project ./tsconfig.build.json

ENV S6_CMD_ARG0=/command/with-contenv
CMD [ "/command/envfile", "/usr/src/app/config/env", "/usr/src/app/entry.sh" ]

# Set up a test image that can be reused
FROM runtime AS test

# hadolint ignore=DL3008
RUN apt-get update \
	&& apt-get install -y --no-install-recommends python3-pglast \
	&& rm -rf /var/lib/apt/lists/*

RUN npm ci && npm run lint

# Make the default output be the runtime image
FROM runtime
