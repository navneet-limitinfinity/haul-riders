import test from "node:test";
import assert from "node:assert/strict";
import { startHttpServer } from "../src/http/startHttpServer.js";
import { createTestLogger } from "./helpers/logger.js";

const createMockServer = () => {
  const handlers = new Map();

  return {
    once(eventName, handler) {
      handlers.set(eventName, handler);
      return this;
    },
    off(eventName, handler) {
      if (handlers.get(eventName) === handler) handlers.delete(eventName);
      return this;
    },
    emit(eventName, payload) {
      const handler = handlers.get(eventName);
      if (handler) {
        handlers.delete(eventName);
        handler(payload);
      }
    },
  };
};

test("startHttpServer resolves on listening and rejects on error", async () => {
  const logger = createTestLogger();
  const env = { host: "127.0.0.1", port: 3000 };

  const server1 = createMockServer();
  const app1 = { listen: () => server1 };
  const p1 = startHttpServer({ app: app1, env, logger });
  server1.emit("listening");
  const resolved = await p1;
  assert.equal(resolved, server1);

  const server2 = createMockServer();
  const app2 = { listen: () => server2 };
  const p2 = startHttpServer({ app: app2, env, logger });
  server2.emit("error", new Error("EADDRINUSE"));
  await assert.rejects(p2, /EADDRINUSE/);
});

