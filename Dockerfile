FROM node:20-alpine
RUN apk add --no-cache tzdata \
 && mkdir -p /data && chown node:node /data
WORKDIR /app
COPY server.js ./
COPY public ./public
ENV PORT=8080 DATA_DIR=/data NODE_ENV=production
VOLUME /data
EXPOSE 8080
USER node
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:8080/healthz || exit 1
CMD ["node", "server.js"]
