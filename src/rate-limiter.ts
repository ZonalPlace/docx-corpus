/**
 * Token bucket rate limiter for parallel requests.
 * Ensures requests don't exceed N per second across all concurrent workers.
 */
export function createRateLimiter(requestsPerSecond: number) {
  let tokens = requestsPerSecond;
  let lastRefill = Date.now();

  return async function acquire(): Promise<void> {
    const now = Date.now();
    const elapsed = now - lastRefill;

    // Refill tokens based on time elapsed
    tokens = Math.min(
      requestsPerSecond,
      tokens + (elapsed / 1000) * requestsPerSecond,
    );
    lastRefill = now;

    if (tokens >= 1) {
      tokens -= 1;
      return;
    }

    // Wait for next token
    const waitMs = ((1 - tokens) / requestsPerSecond) * 1000;
    await new Promise((r) => setTimeout(r, waitMs));
    tokens = 0;
  };
}
