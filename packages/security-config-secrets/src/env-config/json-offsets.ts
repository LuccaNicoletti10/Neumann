/**
 * Passo 3 / US20250298632A1 (config de ambiente editavel remotamente):
 * Parser JSON (com suporte a comentarios // e blocos) que registra, para
 * cada no, os location identifiers: offsets start/end no texto original
 * e o path logico ("services.api.replicas", "items[0].port").
 * E a base do ConfigIndexer — sem dependencia externa de YAML/JSONC.
 */

export type JsonNodeType = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';

export interface IndexedNode {
  /** Path logico, ex.: "services.api.replicas" ou "items[0].port". */
  path: string;
  type: JsonNodeType;
  /** Offsets de caracteres (start inclusivo, end exclusivo) do VALOR no texto. */
  start: number;
  end: number;
  /** Valor escalar (apenas para folhas string/number/boolean/null). */
  value?: string | number | boolean | null;
}

export interface ParsedWithOffsets {
  value: unknown;
  nodes: IndexedNode[];
}

class Parser {
  private pos = 0;
  private readonly nodes: IndexedNode[] = [];

  constructor(private readonly text: string) {}

  parse(): ParsedWithOffsets {
    this.skipWhitespaceAndComments();
    const value = this.parseValue('');
    this.skipWhitespaceAndComments();
    if (this.pos !== this.text.length) {
      throw this.error('conteudo extra apos o valor JSON');
    }
    return { value, nodes: this.nodes };
  }

  private error(msg: string): Error {
    return new Error(`JSON invalido na posicao ${this.pos}: ${msg}`);
  }

  private skipWhitespaceAndComments(): void {
    for (;;) {
      while (this.pos < this.text.length && /\s/.test(this.text[this.pos]!)) this.pos++;
      if (this.text.startsWith('//', this.pos)) {
        const nl = this.text.indexOf('\n', this.pos);
        this.pos = nl === -1 ? this.text.length : nl + 1;
      } else if (this.text.startsWith('/*', this.pos)) {
        const end = this.text.indexOf('*/', this.pos + 2);
        if (end === -1) throw this.error('comentario de bloco nao fechado');
        this.pos = end + 2;
      } else {
        return;
      }
    }
  }

  private peek(): string {
    return this.text[this.pos] ?? '';
  }

  private parseValue(path: string): unknown {
    this.skipWhitespaceAndComments();
    const start = this.pos;
    const ch = this.peek();
    if (ch === '{') return this.parseObject(path, start);
    if (ch === '[') return this.parseArray(path, start);
    if (ch === '"') {
      const s = this.parseString();
      this.nodes.push({ path, type: 'string', start, end: this.pos, value: s });
      return s;
    }
    if (ch === '-' || (ch >= '0' && ch <= '9')) {
      const n = this.parseNumber();
      this.nodes.push({ path, type: 'number', start, end: this.pos, value: n });
      return n;
    }
    for (const [lit, val] of [
      ['true', true],
      ['false', false],
      ['null', null],
    ] as const) {
      if (this.text.startsWith(lit, this.pos)) {
        this.pos += lit.length;
        this.nodes.push({
          path,
          type: val === null ? 'null' : 'boolean',
          start,
          end: this.pos,
          value: val,
        });
        return val;
      }
    }
    throw this.error(`valor inesperado '${ch}'`);
  }

  private parseObject(path: string, start: number): Record<string, unknown> {
    this.pos++; // {
    const obj: Record<string, unknown> = {};
    this.skipWhitespaceAndComments();
    if (this.peek() === '}') {
      this.pos++;
      this.nodes.push({ path, type: 'object', start, end: this.pos });
      return obj;
    }
    for (;;) {
      this.skipWhitespaceAndComments();
      if (this.peek() !== '"') throw this.error("esperava chave (string)");
      const key = this.parseString();
      this.skipWhitespaceAndComments();
      if (this.peek() !== ':') throw this.error("esperava ':'");
      this.pos++;
      const childPath = path === '' ? key : `${path}.${key}`;
      obj[key] = this.parseValue(childPath);
      this.skipWhitespaceAndComments();
      const ch = this.peek();
      if (ch === ',') {
        this.pos++;
        continue;
      }
      if (ch === '}') {
        this.pos++;
        break;
      }
      throw this.error("esperava ',' ou '}'");
    }
    this.nodes.push({ path, type: 'object', start, end: this.pos });
    return obj;
  }

  private parseArray(path: string, start: number): unknown[] {
    this.pos++; // [
    const arr: unknown[] = [];
    this.skipWhitespaceAndComments();
    if (this.peek() === ']') {
      this.pos++;
      this.nodes.push({ path, type: 'array', start, end: this.pos });
      return arr;
    }
    let i = 0;
    for (;;) {
      arr.push(this.parseValue(`${path}[${i}]`));
      i++;
      this.skipWhitespaceAndComments();
      const ch = this.peek();
      if (ch === ',') {
        this.pos++;
        continue;
      }
      if (ch === ']') {
        this.pos++;
        break;
      }
      throw this.error("esperava ',' ou ']'");
    }
    this.nodes.push({ path, type: 'array', start, end: this.pos });
    return arr;
  }

  private parseString(): string {
    this.pos++; // aspas iniciais
    let out = '';
    for (;;) {
      const ch = this.text[this.pos];
      if (ch === undefined) throw this.error('string nao fechada');
      if (ch === '"') {
        this.pos++;
        return out;
      }
      if (ch === '\\') {
        const esc = this.text[this.pos + 1];
        switch (esc) {
          case '"': out += '"'; break;
          case '\\': out += '\\'; break;
          case '/': out += '/'; break;
          case 'b': out += '\b'; break;
          case 'f': out += '\f'; break;
          case 'n': out += '\n'; break;
          case 'r': out += '\r'; break;
          case 't': out += '\t'; break;
          case 'u': {
            const hex = this.text.slice(this.pos + 2, this.pos + 6);
            if (!/^[0-9A-Fa-f]{4}$/.test(hex)) throw this.error('escape \\u invalido');
            out += String.fromCharCode(Number.parseInt(hex, 16));
            this.pos += 4;
            break;
          }
          default:
            throw this.error(`escape invalido '\\${esc}'`);
        }
        this.pos += 2;
      } else {
        out += ch;
        this.pos++;
      }
    }
  }

  private parseNumber(): number {
    const re = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
    re.lastIndex = this.pos;
    const m = re.exec(this.text);
    if (!m) throw this.error('numero invalido');
    this.pos += m[0].length;
    return Number(m[0]);
  }
}

/** Parseia JSON (tolerando comentarios) registrando offsets de cada no. */
export function parseJsonWithOffsets(text: string): ParsedWithOffsets {
  return new Parser(text).parse();
}

/** Serializa um escalar JSON em forma compacta (para insertText cirurgico). */
export function serializeScalar(value: string | number | boolean | null): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('numero nao finito nao serializavel');
    return String(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return 'null';
}