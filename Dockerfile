FROM balena/open-balena-base:21.0.19-s6-overlay@sha256:4e12dfce462ebd88507c1813cfe3466f0843026d2456bb5599b9a2732348b242 AS runtime

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
