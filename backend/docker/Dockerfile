FROM node:20-alpine

WORKDIR /app

COPY backend/package.json backend/yarn.lock* ./
RUN yarn install

COPY backend/tsconfig.json ./
COPY backend/src/ ./src/

# Copy IDL so the server can load the program definition at runtime
COPY target/idl/ ./target/idl/

RUN yarn build

RUN yarn install --production

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "dist/server.js"]
