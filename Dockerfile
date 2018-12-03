FROM balena/open-balena-base:v5.0.1

EXPOSE 80

COPY package.json package-lock.json /usr/src/app/
RUN npm ci --unsafe-perm --production --ignore-scripts && npm cache clean --force

COPY . /usr/src/app

RUN npx tsc --noEmit

COPY config/services/ /etc/systemd/system/

RUN systemctl enable open-balena-api.service
