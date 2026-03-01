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
  name(): `$${string}$`;
};

const INVALID_RE = /[^\p{ID_Continue}$\u200c\u200d]+/ug;
export function emit<K extends StateName>(
  parser: Parser<K>
) {
  let c = 0;
  const ctx: EmitCtx<K> = {
    vars: new Map,
    stateMap: new Map,
    funcToState: new Map,
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

const VAR_RE = /("(?:\\.|[^"])*"|'(?:\\.|[^'])*'|`(?:\\.|[^`])*`|\/\*[\s\S]*?\*\/|\/\/.*)|((?<!\.\??\s*)\b[\p{ID_Start}_$][\p{ID_Continue}$\u200c\u200d]*\b)/ug;
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
  return start + body.replaceAll(VAR_RE, (match, skip, name, offset) => {
    if (skip) return skip;

    const mapped = k.get(name);
    if (!mapped) return name;

    const before = body.slice(0, offset).trimEnd();
    const after = body.slice(offset + name.length).trimStart();

    // 1. Determine if we are inside a Function Call (...) or Object Literal {...}
    // We scan backwards to see which opener we hit first.
    let isInsideParens = false;
    let isInsideBraces = false;
    let depth = 0;

    for (let i = before.length - 1; i >= 0; i--) {
      if (before[i] === ')' || before[i] === '}') depth++;
      if (before[i] === '(' || before[i] === '{') {
        if (depth > 0) {
          depth--;
        } else {
          if (before[i] === '(') isInsideParens = true;
          if (before[i] === '{') isInsideBraces = true;
          break;
        }
      }
    }

    // 2. Strict Shorthand Rule:
    // Must be inside Braces, NOT inside Parens, and surrounded by { , or }
    const isShorthand = isInsideBraces && !isInsideParens &&
      (before.trim().endsWith('{') || before.trim().endsWith(',')) &&
      (after.startsWith('}') || after.startsWith(','));

    if (isShorthand) {
      return `${name}: ${mapped}`;
    }

    // 3. Regular value (handles 'd' in 'b(c, d, e)')
    return mapped;
  }) + end;
}
