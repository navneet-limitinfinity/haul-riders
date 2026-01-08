/**
 * Minimal structured logger.
 * Replace with pino/winston later if needed.
 */
export function createLogger({ level }) {
  const levelOrder = { debug: 10, info: 20, warn: 30, error: 40 };
  const minLevel = levelOrder[level] ?? levelOrder.info;

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
      ...fields,
    };

    const output = JSON.stringify(record);
    // stderr for warnings/errors, stdout otherwise
    if (logLevel === "warn" || logLevel === "error") process.stderr.write(output + "\n");
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
