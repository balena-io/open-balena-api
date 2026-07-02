FROM balena/open-balena-base:21.0.28-s6-overlay@sha256:882e2506e722d3dfb6986624561447d0244c2bf901757f7a77c7250a7cf13bac AS runtime

EXPOSE 80

COPY package.json package-lock.json /usr/src/app/
RUN HUSKY=0 npm ci --omit=dev && npm cache clean --force

COPY . /usr/src/app

RUN npx tsc --noEmit --project ./tsconfig.build.json

CMD [ "/usr/src/app/entry.sh" ]

# Set up a test image that can be reused
FROM runtime AS test

# hadolint ignore=DL3008
RUN apt-get update \
	&& apt-get install -y --no-install-recommends python3-pglast \
	&& rm -rf /var/lib/apt/lists/*

RUN npm ci && npm run lint

# Make the default output be the runtime image
FROM runtime
