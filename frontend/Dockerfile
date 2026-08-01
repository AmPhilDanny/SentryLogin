FROM node:18-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . ./
# VITE_* vars are baked into the bundle at build time; vite preview
# does NOT re-apply runtime env vars, so this must be a build ARG.
ARG VITE_API_URL=http://localhost:3000/api
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM node:18-slim AS runner
WORKDIR /app
# vite is a devDependency but is required to serve preview; copy full
# node_modules from builder (do NOT use --only=production here).
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./
EXPOSE 5173
CMD ["npx", "vite", "preview", "--host", "0.0.0.0", "--port", "5173"]
