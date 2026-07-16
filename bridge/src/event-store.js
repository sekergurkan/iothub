function clampInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, minimum), maximum);
}

export class EventStore {
  #events = [];
  #subscribers = new Set();
  #nextSequence = 1;
  #limit;

  constructor(limit = process.env.EVENT_HISTORY_LIMIT) {
    this.#limit = clampInteger(limit, 500, 50, 5_000);
  }

  record(event) {
    if (!event || typeof event !== "object" || Array.isArray(event)) return null;
    const entry = {
      ...structuredClone(event),
      bridgeSequence: this.#nextSequence++,
      receivedAt: new Date().toISOString(),
    };
    this.#events.push(entry);
    if (this.#events.length > this.#limit) {
      this.#events.splice(0, this.#events.length - this.#limit);
    }

    for (const subscriber of this.#subscribers) {
      try {
        subscriber(entry);
      } catch {
        // A disconnected stream must not interrupt event processing.
      }
    }
    return structuredClone(entry);
  }

  list({ after = 0, limit = 100 } = {}) {
    const safeAfter = clampInteger(after, 0, 0, Number.MAX_SAFE_INTEGER);
    const safeLimit = clampInteger(limit, 100, 1, this.#limit);
    return this.#events
      .filter((event) => event.bridgeSequence > safeAfter)
      .slice(-safeLimit)
      .map((event) => structuredClone(event));
  }

  subscribe(callback) {
    this.#subscribers.add(callback);
    return () => this.#subscribers.delete(callback);
  }

  get subscriberCount() {
    return this.#subscribers.size;
  }
}
