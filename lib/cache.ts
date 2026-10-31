// Bounded LRU with in-flight request coalescing. Only independent OSM geometry is cached.
export class RequestCache<T> {
  private entries = new Map<string, { value: T; at: number }>();
  private pending = new Map<string, Promise<T>>();
  constructor(
    private limit = 32,
    private ttl = 60_000,
  ) {}
  get(key: string, fetcher: () => Promise<T>): Promise<T> {
    const entry = this.entries.get(key);
    if (entry && Date.now() - entry.at < this.ttl) {
      this.entries.delete(key);
      this.entries.set(key, entry);
      return Promise.resolve(entry.value);
    }
    const existing = this.pending.get(key);
    if (existing) return existing;
    const promise = fetcher()
      .then((value) => {
        this.entries.set(key, { value, at: Date.now() });
        while (this.entries.size > this.limit)
          this.entries.delete(this.entries.keys().next().value!);
        return value;
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }
  clear() {
    this.entries.clear();
  }
}
