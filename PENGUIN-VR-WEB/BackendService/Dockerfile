FROM node:22.16.0-bookworm-slim
WORKDIR /app
COPY package.json server.mjs account-store.mjs ./
ENV HOST=0.0.0.0
ENV PORT=8787
ENV DATABASE_PATH=/data/penguin-vr.sqlite
VOLUME ["/data"]
EXPOSE 8787
CMD ["node", "server.mjs"]
