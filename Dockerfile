# ---------- Build stage ----------
FROM node:20-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY prisma ./prisma
RUN npx prisma generate
COPY src ./src
RUN npm run build

# ---------- Runtime stage ----------
FROM node:20-bookworm-slim AS runtime

# ffmpeg is required at runtime for remux/transcode + ffprobe for media
# analysis. openssl is required by the Prisma query engine.
# For NVIDIA hardware encode support, swap this base image for
# nvidia/cuda + install ffmpeg with nvenc support, and add the
# NVIDIA Container Toolkit on the host.
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg openssl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY prisma ./prisma
RUN npx prisma generate
COPY --from=build /app/dist ./dist

EXPOSE 4100
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
