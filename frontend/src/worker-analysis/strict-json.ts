export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { readonly [key: string]: JsonValue };

export class StrictJsonError extends Error {
  constructor() {
    super("STRICT_JSON_INVALID");
    this.name = "StrictJsonError";
  }
}

class StrictJsonParser {
  private index = 0;

  constructor(private readonly source: string) {}

  parse(): JsonValue {
    this.skipWhitespace();
    const value = this.parseValue();
    this.skipWhitespace();
    if (this.index !== this.source.length) {
      throw new StrictJsonError();
    }
    return value;
  }

  private parseValue(): JsonValue {
    const character = this.source[this.index];
    if (character === "{") {
      return this.parseObject();
    }
    if (character === "[") {
      return this.parseArray();
    }
    if (character === '"') {
      return this.parseString();
    }
    if (character === "-" || (character >= "0" && character <= "9")) {
      return this.parseNumber();
    }
    if (this.source.startsWith("true", this.index)) {
      this.index += 4;
      return true;
    }
    if (this.source.startsWith("false", this.index)) {
      this.index += 5;
      return false;
    }
    if (this.source.startsWith("null", this.index)) {
      this.index += 4;
      return null;
    }
    throw new StrictJsonError();
  }

  private parseObject(): { readonly [key: string]: JsonValue } {
    this.index += 1;
    this.skipWhitespace();
    const result: Record<string, JsonValue> = Object.create(null) as Record<
      string,
      JsonValue
    >;
    const keys = new Set<string>();
    if (this.source[this.index] === "}") {
      this.index += 1;
      return result;
    }

    while (this.index < this.source.length) {
      if (this.source[this.index] !== '"') {
        throw new StrictJsonError();
      }
      const key = this.parseString();
      if (keys.has(key)) {
        throw new StrictJsonError();
      }
      keys.add(key);
      this.skipWhitespace();
      if (this.source[this.index] !== ":") {
        throw new StrictJsonError();
      }
      this.index += 1;
      this.skipWhitespace();
      result[key] = this.parseValue();
      this.skipWhitespace();
      const character = this.source[this.index];
      if (character === "}") {
        this.index += 1;
        return result;
      }
      if (character !== ",") {
        throw new StrictJsonError();
      }
      this.index += 1;
      this.skipWhitespace();
    }
    throw new StrictJsonError();
  }

  private parseArray(): JsonValue[] {
    this.index += 1;
    this.skipWhitespace();
    const result: JsonValue[] = [];
    if (this.source[this.index] === "]") {
      this.index += 1;
      return result;
    }
    while (this.index < this.source.length) {
      result.push(this.parseValue());
      this.skipWhitespace();
      const character = this.source[this.index];
      if (character === "]") {
        this.index += 1;
        return result;
      }
      if (character !== ",") {
        throw new StrictJsonError();
      }
      this.index += 1;
      this.skipWhitespace();
    }
    throw new StrictJsonError();
  }

  private parseString(): string {
    const start = this.index;
    this.index += 1;
    while (this.index < this.source.length) {
      const character = this.source[this.index];
      if (character === '"') {
        this.index += 1;
        try {
          return JSON.parse(this.source.slice(start, this.index)) as string;
        } catch {
          throw new StrictJsonError();
        }
      }
      if (character === "\\") {
        this.index += 1;
        const escape = this.source[this.index];
        if (escape === "u") {
          const hexadecimal = this.source.slice(
            this.index + 1,
            this.index + 5,
          );
          if (!/^[0-9a-fA-F]{4}$/u.test(hexadecimal)) {
            throw new StrictJsonError();
          }
          this.index += 5;
          continue;
        }
        if (!['"', "\\", "/", "b", "f", "n", "r", "t"].includes(escape)) {
          throw new StrictJsonError();
        }
        this.index += 1;
        continue;
      }
      if (character.charCodeAt(0) <= 0x1f) {
        throw new StrictJsonError();
      }
      this.index += 1;
    }
    throw new StrictJsonError();
  }

  private parseNumber(): number {
    const remainder = this.source.slice(this.index);
    const match =
      /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u.exec(
        remainder,
      );
    if (match === null) {
      throw new StrictJsonError();
    }
    this.index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) {
      throw new StrictJsonError();
    }
    return value;
  }

  private skipWhitespace(): void {
    while (
      this.source[this.index] === " " ||
      this.source[this.index] === "\n" ||
      this.source[this.index] === "\r" ||
      this.source[this.index] === "\t"
    ) {
      this.index += 1;
    }
  }
}

export function parseStrictJson(source: string): JsonValue {
  return new StrictJsonParser(source).parse();
}
