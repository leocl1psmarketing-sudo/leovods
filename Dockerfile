FROM node:20-slim

# System deps: ffmpeg + ffprobe (media pipeline) and curl/ca-certificates
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

# Self-contained Linux yt-dlp (no Python needed)
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
      -o /usr/local/bin/yt-dlp && chmod +x /usr/local/bin/yt-dlp

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY server.js ./
COPY public ./public

# Make sure the Windows binary never ships / shadows the Linux yt-dlp
RUN rm -rf bin

ENV PORT=3001
EXPOSE 3001
CMD ["node", "server.js"]
