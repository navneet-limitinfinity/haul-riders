/**
 * Minimal structured logger.
 * Replace with pino/winston later if needed.
 */
export function createLogger({ level }) {
  const levelOrder = { debug: 10, info: 20, warn: 30, error: 40 };
  const minLevel = levelOrder[level] ?? levelOrder.info;

  const serializeError = (error) => {
    if (!(error instanceof Error)) return error;
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause instanceof Error ? serializeError(error.cause) : error.cause,
    };
  };

  const normalizeValue = (value, depth = 0) => {
    if (depth > 6) return "[MaxDepth]";
    if (value instanceof Error) return serializeError(value);
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map((v) => normalizeValue(v, depth + 1));

    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = normalizeValue(v, depth + 1);
    }
    return out;
  };

  const parseLogArgs = (args) => {
    // Support:
    // - logger.info("message")
    // - logger.info({ some: "field" }, "message")
    const [first, second] = args;

    if (typeof first === "string") {
      return { fields: {}, message: first };
    }

    if (first && typeof first === "object" && typeof second === "string") {
      return { fields: first, message: second };
    }

    return { fields: { args }, message: "log" };
  };

  const write = (logLevel, fields, message) => {
    const logLevelValue = levelOrder[logLevel] ?? levelOrder.info;
    if (logLevelValue < minLevel) return;

    const record = {
      timestamp: new Date().toISOString(),
      level: logLevel,
      message,
      ...normalizeValue(fields),
    };

    let output = "";
    try {
      output = JSON.stringify(record);
    } catch (error) {
      output = JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "error",
        message: "Failed to serialize log record",
        serializationError: serializeError(error),
      });
    }
    // stderr for warnings/errors, stdout otherwise
    if (logLevel === "warn" || logLevel === "error")
      process.stderr.write(output + "\n");
    else process.stdout.write(output + "\n");
  };

  return {
    debug: (...args) => {
      const { fields, message } = parseLogArgs(args);
      write("debug", fields, message);
    },
    info: (...args) => {
      const { fields, message } = parseLogArgs(args);
      write("info", fields, message);
    },
    warn: (...args) => {
      const { fields, message } = parseLogArgs(args);
      write("warn", fields, message);
    },
    error: (...args) => {
      const { fields, message } = parseLogArgs(args);
      write("error", fields, message);
    },
  };
}
