FROM balena/open-balena-base:18.0.20 AS runtime

EXPOSE 80

COPY package.json package-lock.json /usr/src/app/
RUN HUSKY=0 npm ci --unsafe-perm --production && npm cache clean --force

COPY . /usr/src/app

RUN npx tsc --noEmit --project ./tsconfig.build.json

COPY config/services/ /etc/systemd/system/

RUN systemctl enable open-balena-api.service

# Set up a test image that can be reused
FROM runtime AS test

RUN apt update && apt install \
	&& apt install python3-pglast \
	&& rm -rf /var/lib/apt/lists/*

RUN npm ci && npm run lint

# Make the default output be the runtime image
FROM runtime
