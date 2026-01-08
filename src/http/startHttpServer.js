/**
 * Starts the HTTP server.
 * Keeping "listen" separate makes the app easier to test.
 */
export function startHttpServer({ app, env, logger }) {
  return new Promise((resolve) => {
    const server = app.listen(env.port, env.host, () => {
      logger.info(
        { host: env.host, port: env.port },
        "HTTP server listening"
      );
      resolve(server);
    });
  });
}

