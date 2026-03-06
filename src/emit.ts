import type { StateName } from "./graph.js";
import { type Parser, type FnT, skipWs, improves, improves_error } from "./parser.js";

type Func = (...args: any[]) => any;
type O<T extends Func> = Fn<T> | string | bigint | number | boolean | undefined | null | RegExp | O<T>[] | Set<O<T>> | Map<O<T>, O<T>>;
export type Resources<T extends Func> = {
  [key: string]: O<T>;
};
export type Fn<T extends Func, X extends Func = T> = {
  (...args: Parameters<T>): ReturnType<T>;
  resources: Resources<X>;
}
export function logic<T extends Func, X extends Func>(closure: T, resources: Resources<X>): Fn<T, X> {
  const fn = closure as Partial<Fn<T, X>>;
  fn.resources = resources;
  return fn as Fn<T, X>;
}

interface EmitCtx<K extends StateName> {
  readonly vars: Map<string, string>;
  readonly memoMap: Map<O<FnT<K, unknown>>, string>;
  readonly annotations: boolean;
  name(): string;
};

const INVALID_RE = /[^$_\p{ID_Start}\p{ID_Continue}\u200c\u200d]+/ug;
const IS_SIMPLE_RE = /^['"\d\-]/;
const IS_VAR_RE = /^[$_\p{ID_Start}](?:[$_\u200C\u200D\p{ID_Continue}])*$/u;
export function emit<K extends StateName>(
  parser: Parser<K>,
  annotations: boolean = false
) {
  let c = 0;
  const ctx: EmitCtx<K> = {
    vars: new Map,
    memoMap: new Map,
    annotations,
    name() {
      const base36 = (c++).toString(36);
      return `$${base36}$`;
    }
  }
  const { states } = parser.resources;
  for (const [stateKey, state] of states) {
    const nK = `State${ctx.name()}${stateKey.replaceAll(INVALID_RE, '')}`;
    const v = emitValue(ctx, state, nK);
    if (!ctx.vars.has(nK)) {
      ctx.vars.set(nK, v);
    }
  }
  let code = '';

  const externs = new Map<string, Fn<Func, FnT<K, unknown>>>([
    ['parse', parser]
  ]);
  for (const [name, fn] of externs) {
    const v = emitValue(ctx, fn, name);
    if (!ctx.vars.has(name)) {
      ctx.vars.set(name, v);
    }
  }

  const rows: (string | null)[] = [...ctx.vars.keys()];
  const indexToRowName = new Map<string, number>(
    rows.map((k, i) => [k!, i])
  );
  const cols: string[] = [];
  const indexToColName = new Map<string, number>();
  const table: number[][] = Array.from(rows, () => []);
  const directTable: number[][] = Array.from(rows, () => []);
  const getCol = (name: string) => {
    let col = indexToColName.get(name);
    if (col === undefined) {
      col = cols.push(name) - 1;
      indexToColName.set(name, col);
    };
    return col;
  }

  function rewrite(kmap: Map<string, string>) {
    const colIds = [...kmap.keys()].map(k => indexToColName.get(k)).filter(i => i !== undefined);
    for (let i = 0; i < rows.length; i++) {
      const name = rows[i];
      if (name == null) continue;
      if (kmap.has(name)) {
        ctx.vars.delete(name);
        delRow(name);
        continue;
      }
      let hasRef = false;
      for (const col of colIds) {
        if ((table[i][col] ?? 0) > 0) {
          hasRef = true;
          break;
        }
      }
      if (!hasRef) continue;
      const text = ctx.vars.get(name)!;
      const newText = transformCode(text, kmap, false);
      ctx.vars.set(name, newText);
      updateRefs(name, newText);
    }
  }
  function updateRefs(name: string, text: string) {
    const row = indexToRowName.get(name)!;
    const { direct: drefs, indirect: refs } = codeRefs(text);
    directTable[row].fill(0);
    for (const [n, r] of drefs) {
      const col = getCol(n);
      directTable[row][col] = r;
    }
    table[row].fill(0);
    for (const [n, r] of refs) {
      const col = getCol(n);
      table[row][col] = r;
    }
  }
  function delRow(name: string) {
    const row = indexToRowName.get(name);
    if (!row) return;
    rows[row] = null;
    table[row].fill(0);
    directTable[row].fill(0);
    indexToRowName.delete(name);
  }
  function swapRows(a: string, b: string) {
    const row1 = indexToRowName.get(a)!;
    const row2 = indexToRowName.get(b)!;
    [rows[row1], rows[row2]] = [rows[row2], rows[row1]];
    [table[row1], table[row2]] = [table[row2], table[row1]];
    [directTable[row1], directTable[row2]] = [directTable[row2], directTable[row1]];
    indexToRowName.set(a, row2);
    indexToRowName.set(b, row1);
  }
  function refCount(name: string, indirect = true): number {
    const col = indexToColName.get(name);
    if (!col) return 0;

    const t = indirect ? table : directTable;
    let count = 0;
    for (let i = 0; i < rows.length; i++) {
      count += t[i][col] ?? 0;
    }
    return count;
  }

  for (const [name, text] of ctx.vars) {
    updateRefs(name, text);
  }

  for (const [name, text] of ctx.vars) {
    if (IS_VAR_RE.test(text)) {
      ctx.vars.set(name, ctx.vars.get(text)!);
      swapRows(name, text);
      rewrite(new Map([[text, name]]));
      continue;
    } else if (externs.has(name)) {
      continue;
    } else if (IS_SIMPLE_RE.test(text)) {
      rewrite(new Map([[name, text]]));
    } else {
      const directRefs = refCount(name, false);
      if (directRefs === 1) {
        const allRefs = refCount(name, true);
        if (allRefs === directRefs) {
          const row = indexToRowName.get(name)!;
          const segmentAfter = rows.slice(row)
            .filter(k => k != null)
            .map(k => indexToColName.get(k))
            .filter(i => i != undefined);
          let ok = true;
          for (const col of segmentAfter) {
            if ((directTable[row][col] ?? 0) > 0) {
              ok = false;
              break;
            }
          }
          if (ok)
            rewrite(new Map([[name, text]]));
        }
      }
    }
  }

  for (const name of rows) {
    if (name == null) continue;
    const text = ctx.vars.get(name)!;
    if (externs.has(name))
      code += 'export ';
    code += `const ${name} = ${text};\n`;
  }
  const fns = [
    improves,
    improves_error,
    skipWs,
  ];
  for (const fn of fns) {
    const refs = refCount(fn.name);
    if (refs < 1) continue;
    code += `${fn.toString()}\n`;
  }
  return code;
}

function emitValue<K extends StateName>(
  ctx: EmitCtx<K>,
  value: O<FnT<K, unknown>> | Fn<Func, FnT<K, unknown>>,
  suggestedKey?: string
): string {
  if (ctx.memoMap.has(value))
    return ctx.memoMap.get(value)!;
  switch (typeof value) {
    case 'string': return JSON.stringify(value);
    case 'bigint': return value.toString() + 'n';
    case 'number':
    case 'boolean':
    case 'undefined':
      return String(value);
    case 'symbol':
      throw new TypeError(`Cannot serialize symbols!`, { cause: value });
  }
  if (value === null) return 'null';
  let v: string;
  const k = suggestedKey ?? ctx.name();
  ctx.memoMap.set(value, k);
  if (typeof value === 'function') {
    v = emitFn(ctx, value);
  } else if (value instanceof Map) {
    v = `new Map(${emitValue(ctx, [...value.entries()])})`;
  } else if (value instanceof Set) {
    v = `new Set(${emitValue(ctx, [...value.values()])})`;
  } else if (Array.isArray(value)) {
    v = `[${value.map(v => emitValue(ctx, v)).join(',')}]`;
  } else if (value instanceof RegExp) {
    v = value.toString();
  } else {
    const _exhaustive: never = value;
    throw new TypeError(`Internal error: unknown value type`, { cause: value });
  }
  ctx.vars.set(k, v);
  return k;
}

function emitFn<K extends StateName>(
  ctx: EmitCtx<K>,
  value: Fn<Func, FnT<K, unknown>>
): string {
  let e = Object.entries(value.resources);
  let k = new Map<string, string>();
  let n = ctx.name();
  for (const [key, val] of e) {
    const v = emitValue(ctx, val, `${n}${key}`);
    k.set(key, v);
  }
  let inputStr = arrowFunctionToBlock(value.toString());
  return transformCode(inputStr, k, ctx.annotations);
}

import tokenize, { type Token } from "../node_modules/js-tokens/index.js";
function transformCode(code: string, kmap: Map<string, string>, annotations: boolean): string {
  return mapCode(code, (tok) => {
    return kmap.get(tok.value);
  }, (tok) => {
    if (annotations && tok.type === "MultiLineComment" && tok.value
      .slice(2).trimStart().startsWith(':')) {
      return tok.value.slice(2, -2);
    }
  });
}

function codeRefs(code: string): { direct: Map<string, number>, indirect: Map<string, number> } {
  let refs = new Map<string, number>();
  let directRefs = new Map<string, number>();
  mapCode(code, (tok, { stack }) => {
    const orig = refs.get(tok.value) ?? 0;
    refs.set(tok.value, orig + 1);
    if (stack.includes('block'))
      return;
    const dorig = directRefs.get(tok.value) ?? 0;
    directRefs.set(tok.value, dorig + 1);
  });
  return { direct: directRefs, indirect: refs };
}

function arrowFunctionToBlock(code: string): string {
  let transformed = false;
  let result = `${mapCode(code, null, (tok, { stack, tokens, i, peek }) => {
    if (tok.type === "Punctuator" && tok.value === "=>" && stack.length === 0) {
      let nextIdx = peek(i + 1);

      if (tokens[nextIdx] && tokens[nextIdx].type === 'Punctuator' &&
        tokens[nextIdx].value === '{') {
        return;
      }

      transformed = true;
      return "=>{return ";
    }
  })}\n}`; // handles comments - avoids //comment}
  if (transformed) return result;
  return code;
}

type StackT = Array<"block" | "objectKey" | "objectValue" | "bracket" | "paren">;
type CallbackT = (tok: Token, info: {
  stack: StackT,
  lastSigToken: Token | null,
  nlSinceLastSigToken: boolean,
  tokens: Token[],
  i: number,
  peek(n: number): number
}) => string | void;
function mapCode(
  code: string,
  onIdent?: CallbackT | null,
  onTok?: CallbackT | null
): string {
  const tokens = Array.from(tokenize(code));
  let out = "";
  const stack: StackT = [];
  let lastSigToken: Token | null = null;
  let nlSinceLastSigToken = false;
  const isWS = (type: Token['type']) =>
    type === "WhiteSpace" || type.includes("Comment") || type === "LineTerminatorSequence";
  const info = () => ({ stack, lastSigToken, nlSinceLastSigToken, tokens, i, peek });
  const peek = (n: number) => {
    let nextIdx = n;
    while (tokens[nextIdx] && isWS(tokens[nextIdx].type)) {
      nextIdx++;
    }
    return nextIdx;
  }

  let i = 0;
  for (; i < tokens.length; i++) {
    const token = tokens[i];
    const { type, value } = token;

    const replacement = onTok?.(token, info());
    if (replacement != null) {
      out += replacement;
      continue;
    }
    if (type === "LineTerminatorSequence")
      nlSinceLastSigToken = true;
    if (isWS(type)) {
      out += value;
      continue;
    }

    if (type === "Punctuator") {
      if (value === "{") {
        // It is a BLOCK if it follows these specific patterns:
        const isBlock = !lastSigToken || (
          (lastSigToken.type === "Punctuator" && [")", ";", "=>", ']', '}', '++', '--'].includes(lastSigToken.value)) ||
          (lastSigToken.type === "IdentifierName" && ![
            "async", "await", /*"break",*/ "case", /*"catch",*/ /*"class",*/ "const", /*"continue",*/
            /*"debugger",*/ "default", "delete", /*"do",*/ /*"else",*/ "export", /*"extends",*/
            /*"false",*/ /*"finally",*/ "for", "function", "if", "import", "in", "instanceof",
            "let", "new", /*"null",*/ "return", "super", "switch", /*"static",*/ /*"this"*/,
            "throw", /*"true",*/ /*"try",*/ "typeof", "var", "void", "while", "with", "yield",
            /*"enum",*/ /*"implements",*/ /*"interface",*/ "package", "private", "protected", "public"
          ].includes(lastSigToken.value)) ||
          (lastSigToken.type === "IdentifierName" && nlSinceLastSigToken && [
            'return', 'yield'
          ].includes(lastSigToken.value)) ||
          (lastSigToken.type !== "Punctuator" && lastSigToken.type !== "IdentifierName")
        );

        stack.push(isBlock ? "block" : "objectKey");
      } else if (value === "}") {
        stack.pop();
      } else if (value === "[") {
        stack.push("bracket");
      } else if (value === "]") {
        stack.pop();
      } else if (value === "(") {
        stack.push("paren");
      } else if (value === ")") {
        stack.pop();
      } else if (value === "," || value === ":") {
        const scope = stack[stack.length - 1];
        if (scope === "objectValue" || scope === "objectKey")
          stack[stack.length - 1] = value === "," ? "objectKey" : "objectValue";
      }
      out += value;
    } else if (type === "IdentifierName") {
      const scope = stack[stack.length - 1];
      const isPropertyAccess = lastSigToken?.value === "." || lastSigToken?.value === "?.";

      if (scope === "objectKey" && !isPropertyAccess) {
        let nextIdx = peek(i + 1);

        if (tokens[nextIdx] &&
          tokens[nextIdx].type === 'Punctuator' &&
          [',', '}', '='].includes(tokens[nextIdx].value)) {
          const mapped = onIdent?.(token, info());
          if (mapped != null)
            out += `${value}: ${mapped}`; // Shorthand expansion
          else
            out += value;
        } else {
          out += value;
        }
      } else if (!isPropertyAccess) {
        const mapped = onIdent?.(token, info());
        if (mapped != null)
          out += mapped;
        else
          out += value;
      } else {
        out += value;
        nlSinceLastSigToken = false;
        continue;
      }
      if (lastSigToken &&
        lastSigToken.type === "IdentifierName" &&
        ['class', 'interface', 'extends', 'implements', 'enum'].includes(lastSigToken.value)) {
        nlSinceLastSigToken = false;
        continue;
      }
    } else {
      out += value;
    }

    nlSinceLastSigToken = false;
    lastSigToken = token;
  }

  return out;
}
