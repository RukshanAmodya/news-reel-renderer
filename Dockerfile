FROM node:20-slim

# Install ffmpeg and ca-certificates
RUN apt-get update && \
    apt-get install -y ffmpeg ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
