FROM balena/open-balena-base:v14.7.2 as runtime

EXPOSE 80

COPY package.json package-lock.json /usr/src/app/
RUN HUSKY=0 npm ci --unsafe-perm --production && npm cache clean --force

COPY . /usr/src/app

RUN npx tsc --noEmit --project ./tsconfig.build.json

COPY config/services/ /etc/systemd/system/

RUN systemctl enable open-balena-api.service

# Set up a test image that can be reused
FROM runtime as test

RUN npm ci && npm run lint

# Make the default output be the runtime image
FROM runtime
