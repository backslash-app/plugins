// The calculator: a small recursive-descent parser for `+ - * / % ^`,
// parentheses, implicit multiplication (`2pi`, `3(4+1)`), common functions
// and constants.

/** Evaluates `input` if it looks like arithmetic; `undefined` for anything
 * else, so plain searches ("firefox", "42") never show a useless result. */
export function evaluate(input: string): number | undefined {
  const text = input.trim();
  if (!looksLikeMath(text)) return undefined;
  const tokens = tokenize(text);
  if (!tokens) return undefined;
  const parser = new Parser(tokens);
  const value = parser.expr();
  if (value === undefined || parser.pos !== tokens.length || !Number.isFinite(value)) return undefined;
  return value;
}

/** Formats a result without float noise (`0.1 + 0.2` → `0.3`). */
export function format(value: number): string {
  if (value === Math.trunc(value) && Math.abs(value) < 1e15) return String(Math.trunc(value) + 0);
  return value.toFixed(10).replace(/0+$/, "").replace(/\.$/, "");
}

type Token = { num: number } | { ident: string } | { op: string };

/** Rounds halves away from zero, like most calculators (`round(-2.5)` is -3). */
const round = (x: number) => Math.sign(x) * Math.round(Math.abs(x));

const FUNCTIONS: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  round,
  floor: Math.floor,
  ceil: Math.ceil,
  ln: Math.log,
  log: Math.log10,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
};

const CONSTANTS: Record<string, number> = { pi: Math.PI, "π": Math.PI, e: Math.E, tau: 2 * Math.PI };

const OPERATORS = "+-*/%^()×÷";

function looksLikeMath(input: string): boolean {
  const hasOperator = [...input].some((c) => "+-*/%^(×÷".includes(c)) ||
    Object.keys(FUNCTIONS).some((name) => input.includes(`${name}(`));
  const hasDigit = /[0-9]/.test(input);
  return hasOperator && (hasDigit || input.includes("pi")) && new TextEncoder().encode(input).length < 200;
}

const isDigit = (c: string) => c >= "0" && c <= "9";
const isLetter = (c: string) => /\p{Alphabetic}/u.test(c);
const isLetterOrDigit = (c: string) => /[\p{Alphabetic}\p{N}]/u.test(c);

function tokenize(input: string): Token[] | undefined {
  const tokens: Token[] = [];
  const chars = [...input];
  let i = 0;
  while (i < chars.length) {
    const c = chars[i];
    if (/\s/u.test(c) || c === "_") {
      i++;
    } else if (isDigit(c) || c === "." || c === ",") {
      const start = i;
      while (i < chars.length && (isDigit(chars[i]) || chars[i] === "." || chars[i] === ",")) i++;
      // Accept the French decimal comma: "3,5 * 2".
      const text = chars.slice(start, i).join("").replaceAll(",", ".");
      if (!/^(\d+\.?\d*|\.\d+)$/.test(text)) return undefined;
      tokens.push({ num: Number(text) });
    } else if (isLetter(c)) {
      const start = i;
      while (i < chars.length && isLetterOrDigit(chars[i])) i++;
      tokens.push({ ident: chars.slice(start, i).join("").toLowerCase() });
    } else if (OPERATORS.includes(c)) {
      tokens.push({ op: c === "×" ? "*" : c === "÷" ? "/" : c });
      i++;
    } else {
      return undefined;
    }
  }
  return tokens;
}

class Parser {
  pos = 0;
  constructor(private tokens: Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private eat(op: string): boolean {
    const t = this.peek();
    if (t && "op" in t && t.op === op) {
      this.pos++;
      return true;
    }
    return false;
  }

  // expr := term (('+' | '-') term)*
  expr(): number | undefined {
    let value = this.term();
    while (value !== undefined) {
      if (this.eat("+")) {
        const rhs = this.term();
        value = rhs === undefined ? undefined : value + rhs;
      } else if (this.eat("-")) {
        const rhs = this.term();
        value = rhs === undefined ? undefined : value - rhs;
      } else {
        return value;
      }
    }
    return undefined;
  }

  // term := unary (('*' | '/' | '%' | implicit) unary)*
  private term(): number | undefined {
    let value = this.unary();
    while (value !== undefined) {
      let op: string;
      if (this.eat("*")) op = "*";
      else if (this.eat("/")) op = "/";
      else if (this.eat("%")) op = "%";
      else {
        const next = this.peek();
        const implicit = next !== undefined && ("num" in next || "ident" in next || next.op === "(");
        if (!implicit) return value;
        op = "*";
      }
      const rhs = this.unary();
      if (rhs === undefined) return undefined;
      value = op === "*" ? value * rhs : op === "/" ? value / rhs : value % rhs;
    }
    return undefined;
  }

  // unary := '-' unary | '+' unary | power
  private unary(): number | undefined {
    if (this.eat("-")) {
      const v = this.unary();
      return v === undefined ? undefined : -v;
    }
    if (this.eat("+")) return this.unary();
    return this.power();
  }

  // power := atom ('^' unary)?   (right associative)
  private power(): number | undefined {
    const base = this.atom();
    if (base === undefined) return undefined;
    if (this.eat("^")) {
      const exponent = this.unary();
      return exponent === undefined ? undefined : Math.pow(base, exponent);
    }
    return base;
  }

  private atom(): number | undefined {
    const token = this.peek();
    if (!token) return undefined;
    if ("num" in token) {
      this.pos++;
      return token.num;
    }
    if ("op" in token) {
      if (token.op !== "(") return undefined;
      this.pos++;
      const value = this.expr();
      if (value === undefined) return undefined;
      // Tolerate a missing closing parenthesis at the end while typing.
      if (!this.eat(")") && this.pos !== this.tokens.length) return undefined;
      return value;
    }
    this.pos++;
    if (token.ident in CONSTANTS) return CONSTANTS[token.ident];
    const f = FUNCTIONS[token.ident];
    const next = this.peek();
    if (!f || !next || !("op" in next) || next.op !== "(") return undefined;
    const arg = this.atom();
    return arg === undefined ? undefined : f(arg);
  }
}
