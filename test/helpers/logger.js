export function createTestLogger() {
  const noop = () => {};
  return { debug: noop, info: noop, warn: noop, error: noop };
}

