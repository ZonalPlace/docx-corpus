/**
 * Bounded async queue with backpressure support.
 * Push blocks when full, pop blocks when empty.
 */
export class AsyncQueue<T> {
  private items: T[] = [];
  private waitingPushers: (() => void)[] = [];
  private waitingPoppers: ((value: T | null) => void)[] = [];
  private closed = false;

  constructor(private maxSize: number = 1000) {}

  async push(item: T): Promise<void> {
    while (this.items.length >= this.maxSize) {
      await new Promise<void>((resolve) => this.waitingPushers.push(resolve));
    }
    this.items.push(item);
    this.waitingPoppers.shift()?.(item);
  }

  async pop(): Promise<T | null> {
    if (this.items.length > 0) {
      const item = this.items.shift();
      if (item !== undefined) {
        this.waitingPushers.shift()?.();
        return item;
      }
    }
    if (this.closed) return null;
    return new Promise((resolve) => this.waitingPoppers.push(resolve));
  }

  close() {
    this.closed = true;
    for (const resolve of this.waitingPoppers) {
      resolve(null);
    }
  }
}
