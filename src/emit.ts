import type { StateName, StateKey } from "./graph.js";
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
    ctx.vars.set(nK, v);
    ctx.memoMap.set(state, nK);
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
  value: O<FnT<K, unknown>>,
  k: string | null = null
): string {
  if (ctx.memoMap.has(value))
    return ctx.memoMap.get(value)!;
  if (k !== null)
    ctx.memoMap.set(value, k);
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
  let e = Object.entries(value.resources);
  let k = new Map<string, string>();
  let n = ctx.name();
  for (const [key, val] of e) {
    const nK = `${n}${key}`;
    const v = emitValue(ctx, val, nK);
    if (IS_SIMPLE_RE.test(v)) {
      if (ctx.memoMap.get(val) === nK)
        ctx.memoMap.delete(val);
      k.set(key, v);
    } else {
      k.set(key, nK);
      ctx.vars.set(nK, v);
      ctx.memoMap.set(val, nK);
    }
  }
  return transformCode(value.toString(), k, ctx.annotations);
}

import tokenize, { type Token } from "../node_modules/js-tokens/index.js";
function transformCode(code: string, kmap: Map<string, string>, annotations: boolean): string {
  const tokens = Array.from(tokenize(code));
  let out = "";
  const stack: Array<"block" | "objectKey" | "objectValue" | "bracket" | "paren"> = [];
  let lastSigToken: Token | null = null;
  const isWS = (type: Token['type']) =>
    type === "WhiteSpace" || type.includes("Comment") || type === "LineTerminatorSequence";

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const { type, value } = token;

    if (annotations && type === "MultiLineComment" && value
      .slice(2).trimStart().startsWith(':')) {
      out += value.slice(2, -2);
      continue;
    }
    if (isWS(type)) {
      out += value;
      continue;
    }

    if (type === "Punctuator") {
      if (value === "{") {
        // It is a BLOCK if it follows these specific patterns:
        const isBlock = !lastSigToken || (
          (lastSigToken.type === "Punctuator" && [")", ";", "=>"].includes(lastSigToken.value)) ||
          (lastSigToken.type === "IdentifierName" && ["else", "try", "finally", "do"].includes(lastSigToken.value))
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
      const mapped = kmap.get(value);
      const isPropertyAccess = lastSigToken?.value === "." || lastSigToken?.value === "?.";

      if (scope === "objectKey" && !isPropertyAccess) {
        // Peek logic for Key vs Shorthand
        let nextIdx = i + 1;
        while (tokens[nextIdx] && isWS(tokens[nextIdx].type)) {
          nextIdx++;
        }

        if (tokens[nextIdx] && [',', '}', '='].includes(tokens[nextIdx]!.value) && mapped) {
          out += `${value}: ${mapped}`; // Shorthand expansion
        } else {
          out += value;
        }
      } else if (!isPropertyAccess && mapped) {
        out += mapped; // Standard variable replacement
      }
      else {
        out += value;
      }
    } else {
      out += value;
    }

    lastSigToken = token;
  }

  return out;
}
