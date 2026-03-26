import type { StateName } from "./graph.js";
import { type Parser, type FnT, skipWs, improves, improves_error } from "./parser.js";

type Func = (...args: any[]) => any;
type O = Fn<Func> | string | bigint | number | boolean | undefined | null | RegExp | O[] | Set<O> | Map<O, O>;
export type Resources = {
  [key: string]: O;
};
export type Fn<T extends Func> = {
  (...args: Parameters<T>): ReturnType<T>;
  resources: Resources;
}
export function logic<T extends Func>(closure: T, resources: Resources): Fn<T> {
  const fn = closure as Partial<Fn<T>>;
  fn.resources = resources;
  return fn as Fn<T>;
}

interface EmitCtx<K extends StateName> {
  readonly vars: Map<string, string>;
  readonly memoMap: Map<O, string>;
  name(): string;
};

const INVALID_RE = /[^$_\p{ID_Start}\p{ID_Continue}\u200c\u200d]/ug;
const IS_VAR_RE = /^[$_\p{ID_Start}](?:[$_\u200C\u200D\p{ID_Continue}])*$/u;
export function emit<K extends StateName>(
  parser: Parser<K, any>
) {
  let c = 0;
  const ctx: EmitCtx<K> = {
    vars: new Map,
    memoMap: new Map,
    name() {
      const base36 = (c++).toString(36);
      return `$${base36}$`;
    }
  }
  const { states } = parser.resources;
  for (const [stateKey, state] of states) {
    const nK = `State${ctx.name()}${stateKey.replaceAll(INVALID_RE, '_')}`;
    const v = emitValue(ctx, state, nK);
    if (!ctx.vars.has(nK)) {
      ctx.vars.set(nK, v);
    }
  }
  let code = '';

  const externs = new Map<string, Fn<Func>>([
    ['parse', parser]
  ]);
  for (const [name, fn] of externs) {
    const v = emitValue(ctx, fn, name);
    if (!ctx.vars.has(name)) {
      ctx.vars.set(name, v);
    }
  }

  const rows: (string | null)[] = [...ctx.vars.keys()];
  const nameToRow = new Map<string, number>(
    rows.map((k, i) => [k!, i])
  );
  const cols: string[] = [];
  const nameToCol = new Map<string, number>();
  const table: number[][] = Array.from(rows, () => []);
  const directTable: number[][] = Array.from(rows, () => []);
  const getCol = (name: string) => {
    let col = nameToCol.get(name);
    if (col === undefined) {
      col = cols.push(name) - 1;
      nameToCol.set(name, col);
    };
    return col;
  }

  function rewrite(kmap: Map<string, string>) {
    const colIds = [...kmap.keys()].map(k => nameToCol.get(k)).filter(i => i !== undefined);
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
      const newText = transformCode(text, kmap);
      ctx.vars.set(name, newText);
      updateRefs(name, newText);
    }
  }
  function updateRefs(name: string, text: string) {
    const row = nameToRow.get(name)!;
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
    const row = nameToRow.get(name)!;
    rows[row] = null;
    table[row].fill(0);
    directTable[row].fill(0);
    nameToRow.delete(name);
  }
  function swapRows(a: string, b: string) {
    const row1 = nameToRow.get(a)!;
    const row2 = nameToRow.get(b)!;
    [rows[row1], rows[row2]] = [rows[row2], rows[row1]];
    [table[row1], table[row2]] = [table[row2], table[row1]];
    [directTable[row1], directTable[row2]] = [directTable[row2], directTable[row1]];
    nameToRow.set(a, row2);
    nameToRow.set(b, row1);
  }
  function refsTo(name: string, indirect = true): string[] {
    const col = nameToCol.get(name);
    if (!col) return [];

    const t = indirect ? table : directTable;
    const arr: string[] = [];
    for (let i = 0; i < rows.length; i++) {
      const label = rows[i];
      if (label == null) continue;
      const count = t[i][col] ?? 0;
      for (let j = 0; j < count; j++)
        arr.push(label);
    }
    return arr;
  }

  for (const [name, text] of ctx.vars) {
    updateRefs(name, text);
  }

  for (const [name, text] of ctx.vars) {
    if (IS_VAR_RE.test(text) && ctx.vars.has(text)) {
      ctx.vars.set(name, ctx.vars.get(text)!);
      swapRows(name, text);
      rewrite(new Map([[text, name]]));
      continue;
    } else if (externs.has(name)) {
      continue;
    } else {
      const refs = refsTo(name);
      if (refs.length === 1) {
        const drefs = refsTo(name, false);
        if (refs.length === drefs.length) {
          const refName = drefs[0];
          const row = nameToRow.get(refName)!;
          const segmentAfter = rows.slice(row)
            .filter(k => k != null)
            .map(k => nameToCol.get(k))
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
    improves_error
  ];
  for (const fn of fns) {
    const refs = refsTo(fn.name);
    if (refs.length < 1) continue;
    code += `${fn.toString()}\n`;
  }
  return code;
}

function emitValue<K extends StateName>(
  ctx: EmitCtx<K>,
  value: O | Fn<Func>,
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
  value: Fn<Func>
): string {
  let e = Object.entries(value.resources);
  let k = new Map<string, string>();
  let n = ctx.name();
  for (const [key, val] of e) {
    const v = emitValue(ctx, val, `${n}${key}`);
    k.set(key, v);
  }
  let inputStr = arrowFunctionToBlock(value.toString());
  inputStr = methodFunctionToFunction(inputStr);
  return transformCode(inputStr, k);
}

import tokenize, { type Token } from "../node_modules/js-tokens/index.js";
export function transformCode(code: string, kmap: Map<string, string>): string {
  return mapCode(code, (tok) => {
    return kmap.get(tok.value);
  });
}

export function codeRefs(code: string): { direct: Map<string, number>, indirect: Map<string, number> } {
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

export function arrowFunctionToBlock(code: string): string {
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

export function methodFunctionToFunction(code: string): string {
  let isMethodFunction = true;
  mapCode(code, null, (tok, { stack, tokens, i, peek }) => {
    if (stack.length > 0) return;
    if (tok.type === "IdentifierName" && tok.value === "function") { 
      isMethodFunction = false;
    }
    if (tok.type === "Punctuator" && tok.value === "=>") {
      isMethodFunction = false;
    }
  });
  if (isMethodFunction) {
    let name = null;
    code = mapCode(code, null, (tok, { stack, tokens, i, peek }) => {
      if (stack[0] === 'bracket')
        return '';
      if (tok.type === "IdentifierName" && stack.length === 0) {
        let nextIdx = peek(i + 1);
        if (tokens[nextIdx] && tokens[nextIdx].type === 'IdentifierName') {
          return; // handles 'async|get|set|static name() {}'
        }
        if (tokens[nextIdx] && tokens[nextIdx].type === 'Punctuator' && tokens[nextIdx].value === '*') {
          return; // handles 'async* name() {}'
        }
        name = tok.value;
      }
    });
    return `{ ${name == null ? 'f' : ''}${code} }[${JSON.stringify(name ?? 'f')}]`;
  }
  return code;
}

type StackT = Array<"block" | "objectKey" | "objectValue" | "bracket" | "paren">;
type CallbackT = (tok: Token, info: InfoT) => string | void;
type InfoT = {
  stack: StackT,
  lastSigToken: Token | null,
  nlSinceLastSigToken: boolean,
  tokens: Token[],
  i: number,
  peek(n: number): number
};
function detectASI({ lastSigToken, nlSinceLastSigToken, stack }: InfoT) {
  return !lastSigToken || (
    (lastSigToken.type === "Punctuator" && nlSinceLastSigToken && [")", ']', '}', '++', '--'].includes(lastSigToken.value)) ||
    (lastSigToken.type === "Punctuator" && [";", ')'/*sometimes*/].includes(lastSigToken.value)) ||
    (lastSigToken.type === "Punctuator" && lastSigToken.value === '{' && stack.at(-1) === 'block') ||
    (lastSigToken.type === "IdentifierName" && [
      "catch", "class", "do", "else", "extends", "finally", "static", "try"
    ].includes(lastSigToken.value)) ||
    (lastSigToken.type === "IdentifierName" && nlSinceLastSigToken && ![
      "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do", "else", "export", "extends", "false", "finally", "for", "function", "if", "import", "in", "instanceof", "new", "null", "return", "super", "switch", "this", "throw", "true", "try", "typeof", "var", "void", "while", "with", "await"
    ].includes(lastSigToken.value)) ||
    (lastSigToken.type === "IdentifierName" && nlSinceLastSigToken && [
      'return', 'yield', 'break', 'continue', 'debugger', 'false', 'null', 'this',
      'throw', 'true'
    ].includes(lastSigToken.value)) ||
    (lastSigToken.type !== "Punctuator" && lastSigToken.type !== "IdentifierName")
  );
}
export function mapCode(
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
  const info = (): InfoT => ({ stack, lastSigToken, nlSinceLastSigToken, tokens, i, peek });
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
        const isBlock = detectASI(info()) || (
          lastSigToken && lastSigToken.type === 'Punctuator'
          && lastSigToken.value === '=>'
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
      let nextIdx = peek(i + 1);

      if (tokens[nextIdx] &&
        tokens[nextIdx].type === 'Punctuator' &&
        tokens[nextIdx].value === ':') {
        const isLabel = detectASI(info());
        if (isLabel) {
          nlSinceLastSigToken = false;
          continue;
        }
      }

      const scope = stack[stack.length - 1];
      const isPropertyAccess = lastSigToken?.value === "." || lastSigToken?.value === "?.";

      if (scope === "objectKey" && !isPropertyAccess) {
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
        ['class', 'extends'].includes(lastSigToken.value)) {
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
