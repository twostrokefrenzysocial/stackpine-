# Forces Railway to build this as the Node app it is. The repo root is a
# static marketing site, so buildpack auto-detection keeps guessing "static
# website" — a Dockerfile takes precedence over detection entirely.

# Build stage: better-sqlite3 is a native module and compiles from source on
# Railway's builder, which needs Python and a C++ toolchain (gyp ERR! find
# Python otherwise). Keep the toolchain here, out of the runtime image.
FROM node:22-slim AS build
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Runtime stage: just node and the compiled dependencies.
FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
