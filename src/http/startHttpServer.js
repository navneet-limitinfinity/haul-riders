/**
 * Starts the HTTP server.
 * Keeping "listen" separate makes the app easier to test.
 */
export function startHttpServer({ app, env, logger }) {
  return new Promise((resolve, reject) => {
    const server = app.listen(env.port, env.host);

    const onError = (error) => {
      reject(error);
    };

    server.once("error", onError);
    server.once("listening", () => {
      server.off("error", onError);
      logger.info({ host: env.host, port: env.port }, "HTTP server listening");
      resolve(server);
    });
  });
}
