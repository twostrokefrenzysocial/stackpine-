# Forces Railway to build this as the Node app it is. The repo root is a
# static marketing site, so buildpack auto-detection keeps guessing "static
# website" — a Dockerfile takes precedence over detection entirely.
FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production

# Install dependencies first so they cache independently of code changes.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 3000
CMD ["node", "server.js"]
