module.exports = {
  apps: [
    {
      name: "haul-riders",
      script: "src/server.js",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        HOST: "127.0.0.1",
        TRUST_PROXY: "true",
      },
    },
  ],
};
