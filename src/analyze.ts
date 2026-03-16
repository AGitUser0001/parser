import { Graph, Choice, Sequence, type StateKey, type StateName, type StandaloneOperator, isGeneric, type Segments } from './graph.js';
import type { Result } from './parser.js';

export class ParseFailedError extends Error {
  name = 'ParseFailedError';
  declare cause: Result;
  constructor(message: string, options: ErrorOptions & { cause: Result }) {
    super(...arguments);
  }
}

export function validateResult(result: Result, graph?: Graph<StateName> | null) {
  if (!result.ok) {
    const path = findDeepestRightmostPath(result);
    let i = path.length - 1;
    while (i > 0) {
      if (path[i].type === 'state')
        break;
      i--;
    }
    const txt = generateTextFrom(path.slice(i));
    if (graph != undefined) {
      const expected = findExpectedSet(graph, result);
      const expectedTxt = expected.size
        ? `\nExpected one of: ${[...expected].map(r => r.toString()).join(', ')}`
        : '';
      throw new ParseFailedError(`validateResult: Got failing result: ${txt}${expectedTxt}`, { cause: result });
    } else {
      throw new ParseFailedError(`validateResult: Got failing result: ${txt}`, { cause: result });
    }
  }
}

function generateTextFrom(path: Result[]) {
  return path.map(r => {
    let annotation: string | null = null;
    switch (r.type) {
      case 'state':
        annotation = r.state;
        break;
      case 'iteration':
        annotation = `${r.kind}${r.value.length}`;
        break;
      case 'choice':
        annotation = String(r.alt);
        break;
      case 'lookahead':
        annotation = r.positive ? '&' : '!';
        break;
      case 'terminal':
        annotation = String(r.value);
        break;
      case 'sequence':
        annotation = String(r.value.length);
        break;
    }
    return `${r.type}${r.ok ? '_ok' : ''}${annotation == null ? '' : `(${annotation})`}@${r.pos}`;
  }).join(' > ');
}

export function findDeepestRightmostPath(root: Result): Result[] {
  let current = root;
  let path: Result[] = [];

  while (current) {
    path.push(current);
    const val = current.value;

    if (Array.isArray(val)) {
      if (val.length === 0)
        break;
      current = val[val.length - 1];
    } else if (typeof val === 'object' && val !== null) {
      current = val;
    } else {
      const _exhaustive: string | null = val;
      break;
    }
  }

  return path;
}

export function findExpectedSet<K extends StateName>(
  graph: Graph<K>,
  result: Result
): Set<RegExp> {
  const targetPos = result.pos;
  const expected = new Set<RegExp>();

  const lenCache = new WeakMap<Result, number>();
  function lenOf(r: Result): number {
    if (lenCache.has(r)) return lenCache.get(r)!;
    let len: number;
    switch (r.type) {
      case 'none': len = 0; break;
      case 'terminal': len = r.ok ? r.value.length : 0; break;
      case 'state': len = lenOf(r.value); break;
      case 'choice': len = lenOf(r.value); break;
      case 'rewind': len = 0; break;
      case 'lookahead': len = 0; break;
      case 'sequence': len = r.value.reduce((acc, c) => acc + lenOf(c), 0); break;
      case 'iteration': len = r.value.reduce((acc, c) => acc + lenOf(c), 0); break;
      case 'root': len = lenOf(r.value) + (r.trailing_ws ?? '').length; break;
    }
    len += r.ws ? r.ws.length : 0;
    lenCache.set(r, len);
    return len;
  }

  function startOf(r: Result): number {
    return r.pos - lenOf(r) + (r.ws ? r.ws.length : 0);
  }

  function collect(node: Sequence<K> | Choice<K>) {
    for (const re of collectPrefixTerminals(graph, node))
      expected.add(re);
  }

  const path = findDeepestRightmostPath(result);

  let graphCursor: Sequence<K> | Choice<K> | null = null;

  for (let i = 0; i < path.length; i++) {
    const r = path[i];
    const next = path[i + 1];

    switch (r.type) {
      case 'root':
      case 'state': {
        const key = r.type === 'root' ? r.value.state : r.state;
        graphCursor = graph.get(key as K)!;
        break;
      }

      case 'sequence': {
        if (!(graphCursor instanceof Sequence)) break;
        const s: Segments<K> = graphCursor.segments;
        const { body } = s;
        // find the index of the target child (next in path)
        const targetChildResult = next;
        for (let ci = 0; ci < r.value.length; ci++) {
          if (r.value[ci] === targetChildResult) {
            if (startOf(r.value[ci]) === targetPos) {
              const continuation = new Sequence<K>();
              continuation.push(...graphCursor.segments.ops, ...body.slice(ci) as any);
              collect(continuation);
            }
            // advance graph cursor to the target child's graph node
            const graphChild = body[ci];
            if (graphChild instanceof RegExp) {
              graphCursor = null;
            } else if (typeof graphChild === 'string') {
              graphCursor = graph.get(graphChild as K)!;
            } else {
              graphCursor = graphChild;
            }
            break;
          }
        }
        break;
      }

      case 'choice': {
        if (!(graphCursor instanceof Choice)) break;
        const s: Segments<K> = graphCursor.segments;
        const { body } = s;

        if (startOf(r) === targetPos && r.alt !== null) {
          for (let ci = 0; ci < body.length; ci++) {
            if (ci === r.alt) continue;
            const branch = body[ci];
            if (branch instanceof RegExp) {
              expected.add(branch);
            } else if (typeof branch === 'string') {
              collect(graph.get(branch as K)!);
            } else {
              collect(branch);
            }
          }
        }

        // advance graph cursor into taken branch
        if (r.alt !== null) {
          const taken = body[r.alt];
          if (taken instanceof RegExp) {
            if (startOf(r) === targetPos) expected.add(taken);
            graphCursor = null;
          } else if (typeof taken === 'string') {
            graphCursor = graph.get(taken as K)!;
          } else {
            graphCursor = taken;
          }
        }
        break;
      }

      case 'iteration': {
        // graphCursor stays the same — iteration repeats the same graph node
        break;
      }
    }
  }

  return expected;
}

export function collectPrefixDeps<K extends StateName>(
  graph: Graph<K>,
  data: Sequence<K> | Choice<K>
): Set<StateKey<K>> {
  const { nullable, v } = prefix(graph, data);
  return new Set(v.filter(e => typeof e === 'string'));
}

export function collectPrefixTerminals<K extends StateName>(
  graph: Graph<K>,
  data: Sequence<K> | Choice<K>
): Set<RegExp> {
  const { nullable, v } = prefix(graph, data, true);
  return new Set(v.filter(e => e instanceof RegExp));
}

type TV<K extends StateName> = StateKey<K> | RegExp;

export function prefix<K extends StateName>(
  graph: Graph<K>,
  data: Sequence<K> | Choice<K>,
  follow = false,
  seen: string[] = []
): { nullable: boolean; v: TV<K>[]; } {
  if (data instanceof Choice)
    return prefixChoice(graph, data, follow, seen);
  if (data instanceof Sequence)
    return prefixSeq(graph, data, follow, seen);
  throw new TypeError(`Invalid data passed to 'prefix'`, { cause: data });
}

function prefixSeq<K extends StateName>(
  graph: Graph<K>,
  data: Sequence<K>,
  follow: boolean,
  seen: string[]
): { nullable: boolean; v: TV<K>[]; } {
  const { ops, body } = data.segments;
  let nullable = false;
  for (const op of nullableOperators)
    if (ops.has(op))
      nullable = true;

  const output: TV<K>[] = [];
  for (const term of body) {
    if (term instanceof RegExp) {
      output.push(term);
      term.lastIndex = 0;
      if (!term.test('')) {
        return { nullable, v: output };
      }
    } else if (typeof term === 'string') {
      if (!isGeneric(term)) {
        output.push(term);
        if (follow && !seen.includes(term)) {
          const result = prefix(graph, graph.get(term)!, follow, [...seen, term]);
          output.push(...result.v);
          if (!result.nullable)
            return { nullable, v: output };
        } else if (isSolid(graph, graph.get(term)!, [term]))
          return { nullable, v: output };
      }
    } else {
      const result = prefix(graph, term, follow, seen);
      output.push(...result.v);
      if (!result.nullable)
        return { nullable, v: output };
    }
  }
  return { nullable: true, v: output };
}

function prefixChoice<K extends StateName>(
  graph: Graph<K>,
  data: Choice<K>,
  follow: boolean,
  seen: string[]
): { nullable: boolean; v: TV<K>[]; } {
  const { ops, body } = data.segments;

  let nullable = false;
  for (const op of nullableOperators)
    if (ops.has(op))
      nullable = true;

  let v: TV<K>[] = [];

  for (const term of body) {
    let result: { nullable: boolean; v: TV<K>[]; };

    if (term instanceof RegExp) {
      term.lastIndex = 0;
      result = { nullable: term.test(''), v: [term] };

    } else if (typeof term === 'string') {
      if (isGeneric(term)) {
        result = { nullable: true, v: [] };
      } else if (follow && !seen.includes(term)) {
        result = prefix(graph, graph.get(term)!, follow, [...seen, term]);
      } else {
        const solid = isSolid(graph, graph.get(term)!, [term]);
        result = {
          nullable: !solid,
          v: [term]
        };
      }

    } else {
      result = prefix(graph, term, follow, seen);
    }

    nullable ||= result.nullable;
    v.push(...result.v);
  }

  return {
    nullable,
    v
  };
}

const nullableOperators = new Set<StandaloneOperator>([
  '*', '?', '&', '!'
]);
function isSolid<K extends StateName>(
  graph: Graph<K>,
  data: Sequence<K> | Choice<K>,
  seen: string[]
) {
  const { ops, body } = data.segments;
  for (const op of nullableOperators)
    if (ops.has(op))
      return false;
  const isChoice = data instanceof Choice;
  let v = true;
  for (const term of body) {
    if (term instanceof RegExp) {
      term.lastIndex = 0;
      if (!term.test('')) {
        if (!isChoice) return true;
      } else v = false;
    } else if (typeof term === 'string') {
      if (!seen.includes(term) && !isGeneric(term))
        if (isSolid(graph, graph.get(term)!, [...seen, term])) {
          if (!isChoice) return true;
        } else v = false;
      else v = false;
    } else if (isSolid(graph, term, seen)) {
      if (!isChoice) return true;
    } else v = false;
  }
  if (isChoice) return v;
  return false;
}
