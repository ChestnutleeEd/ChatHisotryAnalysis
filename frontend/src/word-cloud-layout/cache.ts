import {
  WORD_CLOUD_LAYOUT_CACHE_CAPACITY,
  type WordCloudLayoutResultV1,
} from "./contracts";

export class WordCloudLayoutCache {
  private readonly entries = new Map<string, WordCloudLayoutResultV1>();

  constructor(
    readonly capacity = WORD_CLOUD_LAYOUT_CACHE_CAPACITY,
  ) {
    if (!Number.isSafeInteger(capacity) || capacity <= 0 || capacity > 6) {
      throw new Error("INVALID_WORD_CLOUD_LAYOUT_CACHE_CAPACITY");
    }
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: string): WordCloudLayoutResultV1 | undefined {
    const value = this.entries.get(key);
    if (value === undefined) {
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: string, value: WordCloudLayoutResultV1): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) {
        break;
      }
      this.entries.delete(oldest);
    }
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  clear(): void {
    this.entries.clear();
  }
}
