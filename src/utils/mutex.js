// Simple in-process mutex keyed by string.
// Ensures that tasks for the same key run sequentially.

const queues = new Map();

export async function withLock(key, fn) {
  const prev = queues.get(key) || Promise.resolve();
  let resolveNext;
  const next = new Promise((res) => (resolveNext = res));
  queues.set(key, prev.then(() => next));

  try {
    const result = await fn();
    resolveNext();
    // If no one else chained, clean up
    if (queues.get(key) === next) queues.delete(key);
    return result;
  } catch (err) {
    resolveNext();
    if (queues.get(key) === next) queues.delete(key);
    throw err;
  }
}

