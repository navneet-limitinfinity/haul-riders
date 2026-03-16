FROM node:24-slim

WORKDIR /workspace

COPY functions/package*.json ./
RUN npm install --production

COPY functions/. .
COPY src /src

ENV PORT=8080
EXPOSE 8080

CMD ["npm", "start"]
