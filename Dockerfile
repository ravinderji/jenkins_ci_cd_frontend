# ── Stage 1: Build React app ─────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --silent
COPY . .
# Build args injected by Jenkins at docker build time
ARG VITE_BACKEND_URL
ARG VITE_BUILD_NUMBER
ENV VITE_BACKEND_URL=${VITE_BACKEND_URL}
ENV VITE_BUILD_NUMBER=${VITE_BUILD_NUMBER}
RUN npm run build

# ── Stage 2: Serve with nginx ────────────────────────────────────────
FROM nginx:1.25-alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost/ || exit 1
CMD ["nginx", "-g", "daemon off;"]
