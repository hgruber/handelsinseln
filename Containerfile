FROM docker.io/library/node:20-slim
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY shared ./shared
COPY public ./public
RUN mkdir /data && chown node:node /data
ARG APP_VERSION=
ENV APP_VERSION=$APP_VERSION
ENV PORT=8080 DATA_DIR=/data NODE_ENV=production
VOLUME /data
USER node
EXPOSE 8080 8443
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:8080/api/lobby').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/server.js"]
