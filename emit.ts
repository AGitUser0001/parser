import type { StateName, StateKey } from "./graph.js";
import { type Parser, type FnT, skipWs, improves, improves_error } from "./parser.js";

type Func = (...args: any[]) => any;
type O<T extends Func> = Fn<T> | string | bigint | number | boolean | undefined | null | RegExp | O<T>[] | Set<O<T>> | Map<O<T>, O<T>>;
export type Resources<T extends Func> = {
  [key: string]: O<T>;
} & { toState?: [string, StateName] };
export type Fn<T extends Func, X extends Func = T> = {
  (...args: Parameters<T>): ReturnType<T>;
  resources: Resources<X>;
}
export function logic<T extends Func, X extends Func>(closure: T, resources: Resources<X>): Fn<T, X> {
  const fn = closure as Partial<Fn<T, X>>;
  fn.resources = Object.freeze(resources);
  return fn as Fn<T, X>;
}

interface EmitCtx<K extends StateName> {
  readonly vars: Map<string, string>;
  readonly funcToState: Map<Fn<FnT<K, unknown>>, StateKey<K>>;
  readonly stateMap: Map<StateKey<K>, string>;
  readonly annotations: boolean;
  name(): `$${string}$`;
};

const INVALID_RE = /[^$_\p{ID_Start}\p{ID_Continue}\u200c\u200d]+/ug;
export function emit<K extends StateName>(
  parser: Parser<K>,
  annotations: boolean = false
) {
  let c = 0;
  const ctx: EmitCtx<K> = {
    vars: new Map,
    stateMap: new Map,
    funcToState: new Map,
    annotations,
    name() {
      const base36 = (++c).toString(36).padStart(6, '0');
      return `$${base36}$`;
    }
  }
  const { states } = parser.resources;
  for (const stateKey of states.keys()) {
    let nK = `State${ctx.name()}${stateKey.replaceAll(INVALID_RE, '')}`;
    ctx.stateMap.set(stateKey, nK);
    ctx.vars.set(nK, `() => { throw new Error("Internal error: state definition missing."); }`);
  }
  for (const [stateKey, state] of states) {
    const nK = ctx.stateMap.get(stateKey)!;
    ctx.vars.set(nK, emitValue(ctx, state));
    ctx.funcToState.set(state, stateKey);
  }
  let code = '';
  let parserv = emitFn(ctx, parser);
  for (const [name, text] of ctx.vars) {
    code += `const ${name} = ${text};\n`;
  }
  let fns = [
    improves,
    improves_error,
    skipWs,
  ];
  let fnv = fns
    .map(fn => fn.toString() + '\n')
    .join('');
  code += fnv;
  code += `export const parse = ${parserv};`;
  return code;
}

function emitValue<K extends StateName>(
  ctx: EmitCtx<K>,
  value: O<FnT<K, unknown>>
): string {
  switch (typeof value) {
    case 'string': return JSON.stringify(value);
    case 'bigint': return value.toString() + 'n';
    case 'number':
    case 'boolean':
    case 'undefined':
      return String(value);
    case 'function':
      return emitFn(ctx, value);
    case 'symbol':
      throw new TypeError(`Cannot serialize symbols!`, { cause: value });
  }
  if (value === null) return 'null';
  if (value instanceof Map) {
    return `new Map(${emitValue(ctx, [...value.entries()])})`;
  }
  if (value instanceof Set) {
    return `new Set(${emitValue(ctx, [...value.values()])})`;
  }
  if (Array.isArray(value)) {
    return `[${value.map(v => emitValue(ctx, v)).join(',')}]`;
  }
  if (value instanceof RegExp)
    return value.toString();
  const _exhaustive: never = value;
  throw new TypeError(`Internal error: unknown value type`, { cause: value });
}

const IS_SIMPLE_RE = /^[$_\p{ID_Start}](?:[$_\u200C\u200D\p{ID_Continue}])*$|^['"\d\-]/u;
function emitFn<K extends StateName>(
  ctx: EmitCtx<K>,
  value: Fn<Func, FnT<K, unknown>>
): string {
  if (ctx.funcToState.has(value)) {
    const stateKey = ctx.funcToState.get(value)!;
    return ctx.stateMap.get(stateKey)!;
  }
  let e = Object.entries(value.resources);
  let k = new Map<string, string>();
  if (value.resources.toState !== undefined) {
    k.set(value.resources.toState[0], ctx.stateMap.get(value.resources.toState[1] as StateKey<K>)!);
  }
  for (const [key, val] of e) {
    if (key === 'toState') continue;
    let v = emitValue(ctx, val);
    if (IS_SIMPLE_RE.test(v))
      k.set(key, v)
    else {
      const nK = `${ctx.name()}${key}` as const;
      k.set(key, nK);
      ctx.vars.set(nK, v);
    }
  }
  let str = value.toString();
  let start = str.slice(0, str.indexOf('{'));
  let body = str.slice(str.indexOf('{'), str.lastIndexOf('}'));
  let end = str.slice(str.lastIndexOf('}'));
  return start + transformCode(body, k, ctx.annotations) + end;
}

function transformCode(
  code: string,
  kmap: Map<string, string>,
  annotations: boolean
): string {
  let i = 0;
  let out = '';
  type Scope = { type: 'stmt', expr: boolean } | { type: 'block' | 'templExpr' | 'template' | 'paren' | 'bracket' } | { type: 'object'; expect: 'key' | 'value' };
  const isObjectLiteralPosition = (prev: string | null): boolean => {
    return (
      prev === '=' ||
      prev === '(' ||
      prev === '[' ||
      prev === ',' ||
      prev === ':' ||
      prev === '?' ||
      prev === '!' ||
      prev === '${' ||
      (!!prev && isIdStart(prev)) ||
      (!!prev && isIdContinue(prev))
    );
  }
  const scopes: Scope[] = [{ type: 'stmt', expr: false }];

  const isIdStart = (ch: string) =>
    /[$_\p{ID_Start}]/u.test(ch);

  const isIdContinue = (ch: string) =>
    /[$\u200C\u200D_\p{ID_Continue}]/u.test(ch);

  const peek = (n = 0) => code[i + n];

  function consumeString(quote: string) {
    let start = i++;
    while (i < code.length) {
      if (code[i] === '\\') {
        // Proper unicode escape handling
        if (code[i + 1] === 'u' && code[i + 2] === '{') {
          i += 3;
          while (i < code.length && code[i] !== '}') i++;
          i++;
        } else if (code[i + 1] === 'u') {
          i += 6;
        } else if (code[i + 1] === 'x') {
          i += 4;
        } else {
          i += 2;
        }
        continue;
      }
      if (code[i] === quote) {
        i++;
        break;
      }
      i++;
    }
    return code.slice(start, i);
  }

  function consumeIdentifier() {
    let start = i++;
    while (i < code.length && isIdContinue(code[i])) i++;
    return code.slice(start, i);
  }

  function consumeBlockComment() {
    i += 2;
    let start = i;
    while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) i++;
    const content = code.slice(start, i);
    i += 2;

    if (annotations && content.trimStart().startsWith(':')) {
      return ': ' + content.trimStart().slice(1).trimStart();
    }

    return '/*' + content + '*/';
  }

  let lastSigChar: string | null = null;
  while (i < code.length) {
    const scope = scopes[scopes.length - 1];
    const ch = peek();

    // ========================
    // Strings
    // ========================

    if (scope.type === 'template') {
      if (ch === '\\') {
        out += code.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (ch === '`') {
        scopes.pop();
        out += ch;
        i++;
        continue;
      }
      if (ch === '$' && peek(1) === '{') {
        scopes.push({ type: 'templExpr' });
        out += '${';
        lastSigChar = '${';
        i += 2;
        continue;
      }
      out += ch;
      i++;
      continue;
    }

    if (ch === '"' || ch === "'") {
      out += consumeString(ch);
      lastSigChar = ch;
      continue;
    }

    if (ch === '`') {
      scopes.push({ type: 'template' });
      out += ch;
      i++;
      continue;
    }

    // ========================
    // Comments
    // ========================
    if (ch === '/' && peek(1) === '/') {
      let start = i;
      while (i < code.length && code[i] !== '\n') i++;
      out += code.slice(start, i);
      continue;
    }

    if (ch === '/' && peek(1) === '*') {
      out += consumeBlockComment();
      continue;
    }

    if (ch === '{') {
      if (isObjectLiteralPosition(lastSigChar)) {
        scopes.push({ type: 'object', expect: 'key' });
      } else {
        scopes.push({ type: 'block' });
      }

      out += ch;
      lastSigChar = ch;
      i++;
      continue;
    }

    if (ch === '}') {
      scopes.pop();
      out += ch;
      lastSigChar = ch;
      i++;
      continue;
    }

    // ========================
    // Paren / Bracket
    // ========================
    if (ch === '(') {
      scopes.push({ type: 'paren' });
      out += ch;
      lastSigChar = ch;
      i++;
      continue;
    }

    if (ch === ')') {
      scopes.pop();
      out += ch;
      lastSigChar = ch;
      i++;
      continue;
    }

    if (ch === '[') {
      scopes.push({ type: 'bracket' });
      out += ch;
      lastSigChar = ch;
      i++;
      continue;
    }

    if (ch === ']') {
      scopes.pop();
      out += ch;
      lastSigChar = ch;
      i++;
      continue;
    }

    // ========================
    // Identifier handling
    // ========================
    if (isIdStart(ch)) {
      const name = consumeIdentifier();
      const mapped = kmap.get(name);

      const isPropertyAccess =
        lastSigChar === '.' ||
        (lastSigChar === '?' && out.trimEnd().endsWith('?.'));

      if (scope.type === 'object' && scope.expect === 'key') {
        // lookahead for :
        let j = i;
        while (/\s/.test(code[j])) j++;

        if (code[j] === ':') {
          // real key
          out += name;
          scope.expect = 'value';
          lastSigChar = out.trimEnd().at(-1)!;
          continue;
        }

        // shorthand
        if (mapped) {
          out += name + ': ' + mapped;
        } else {
          out += name;
        }

        scope.expect = 'value';
        lastSigChar = out.trimEnd().at(-1)!;
        continue;
      }

      if (!isPropertyAccess && mapped) {
        out += mapped;
      } else {
        out += name;
      }

      lastSigChar = out.trimEnd().at(-1)!;
      continue;
    }

    // ========================
    // Object comma / colon tracking
    // ========================
    if (scope.type === 'object') {
      if (ch === ',') {
        scope.expect = 'key';
        lastSigChar = ch;
      }
      if (ch === ':') {
        scope.expect = 'value';
        lastSigChar = ch;
      }
    }

    out += ch;
    if (!/\s/.test(ch))
      lastSigChar = ch;
    i++;
  }

  return out;
}
