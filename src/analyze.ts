import { Graph, Choice, Sequence, type StateKey, type StateName, type StandaloneOperator, isGeneric, type Segments } from './graph.js';
import type { Result } from './parser.js';

export class ParseFailedError extends Error {
  name = 'ParseFailedError';
  declare cause: Result;
  constructor(message: string, options: ErrorOptions & { cause: Result }) {
    super(message, options);
  }
}

export function validateResult(result: Result, graph?: Graph<StateName> | null) {
  if (!result.ok) {
    const path = findIdealPath(result);
    let i = path.length - 1;
    while (i > 0) {
      if (path[i].type === 'state')
        break;
      i--;
    }
    const txt = generateTextFrom(path.slice(i));
    if (graph != undefined) {
      const expected = findExpectedSet(graph, path);
      const expectedStr = [...expected].map(r => r.toString()).join(', ');
      const expectedTxt = expected.size === 1 ?
        `\nExpected ${expectedStr}` :
        expected.size
          ? `\nExpected one of: ${expectedStr}`
          : '\nExpected end of input';
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

export function findRightmostPath(root: Result): Result[] {
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

export function findIdealPath(root: Result, start: number = 0): Result[] { 
  return findPathToPos(root, root.pos, start);
}

export function findPathToPos(
  root: Result,
  target: number,
  start: number = 0
): Result[] {
  const path: Result[] = [];
  let cursor = start;

  let current: Result | null = root;

  while (current) {
    path.push(current);

    // Node spans [cursor, current.pos)
    const nodeStart = cursor;
    const nodeEnd = current.pos;

    const wsLen = current.ws?.length ?? 0;

    // 1. Leading WS
    if (target < nodeStart + wsLen) {
      return path;
    }

    cursor = nodeStart + wsLen;

    // 2. Trailing WS (only root has it)
    if (current.type === 'root') {
      const trailingLen = current.trailing_ws?.length ?? 0;
      if (target > nodeEnd - trailingLen) {
        return path;
      }
    }

    switch (current.type) { 
      case 'sequence':
      case 'iteration': {
        const children: Result[] = current.value;
        const idx = findChildIndex(children, target);

        if (idx >= children.length) {
          return path;
        }

        // we advance cursor to the start of this child
        if (idx > 0) {
          cursor = children[idx - 1].pos;
        }

        current = children[idx];
        break;
      }
      case 'terminal':
      case 'none':
      case 'lookahead':
        return path;
      case 'choice':
      case 'rewind':
      case 'root':
      case 'state':
        current = current.value;
        break;
    }
  }

  return path;
}

function findChildIndex(children: Result[], target: number): number {
  let lo = 0;
  let hi = children.length;

  while (lo < hi) {
    const mid = (lo + hi) >> 1;

    if (target <= children[mid].pos) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }

  // lo is first candidate — now skip lookaheads (prefer left)
  let idx = lo;

  // Prefer left: walk backward first
  while (idx > 0 && children[idx - 1].type === 'lookahead') {
    idx--;
  }

  // If still on a lookahead, walk forward
  while (idx < children.length && children[idx].type === 'lookahead') {
    idx++;
  }

  return idx;
}

export function findExpectedSet<K extends StateName>(
  graph: Graph<K>,
  path: Result[]
): Set<RegExp> {
  const expected = new Set<RegExp>();

  function collect(node: Sequence<K> | Choice<K> | RegExp) {
    if (node instanceof RegExp) {
      expected.add(node);
    } else for (const re of collectPrefixTerminals(graph, node)) {
      expected.add(re);
    }
  }

  const deepest = path[path.length - 1];
  const startOfSplitPoint = lenGtZero(deepest) ? path.length : findSplitPoint(path, isAtStartOf);
  const endOfSplitPoint = findSplitPoint(path, isAtEndOf);

  let graphCursor: Sequence<K> | Choice<K> | RegExp | null = null;

  for (let i = 0; i < path.length; i++) {
    const r = path[i];
    const nextIdx = i + 1;
    const next = path[nextIdx];

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
            if (targetChildResult.ok)
              if (nextIdx >= endOfSplitPoint) {
                const continuation = new Sequence<K>();
                continuation.push(...graphCursor.segments.ops, ...body.slice(ci + 1) as any);
                collect(continuation);
              }
            // advance graph cursor to the target child's graph node
            const graphChild = body[ci];
            if (typeof graphChild === 'string') {
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

        if (i >= startOfSplitPoint) {
          for (let ci = 0; ci < body.length; ci++) {
            if (ci === r.alt) continue;
            const branch = body[ci];
            if (typeof branch === 'string') {
              collect(graph.get(branch as K)!);
            } else {
              collect(branch);
            }
          }
        }

        // advance graph cursor into taken branch
        if (r.alt !== null) {
          const taken = body[r.alt];
          if (typeof taken === 'string') {
            graphCursor = graph.get(taken as K)!;
          } else {
            graphCursor = taken;
          }
        }
        break;
      }

      case 'iteration': {
        if (graphCursor === null) break;
        // graphCursor stays the same — iteration repeats the same graph node
        if (r.ok) {
          if (i >= endOfSplitPoint) {
            // iteration could repeat — collect FIRST of body
            if (r.kind === '?' && r.value.length > 0) break;
            if (r.kind === '@') break;
            collect(graphCursor);
          }
        }
        break;
      }

      case 'terminal':
        if (!(graphCursor instanceof RegExp)) break;
        if (!r.ok) {
          collect(graphCursor);
        }
        break;

      case 'lookahead':
      case 'none':
      case 'rewind':
        break;

      default:
        const _exhaustive: never = r;
    }
  }

  return expected;
}

function findSplitPoint(path: Result[], fn: (node: Result, parent: Result) => boolean) {
  for (let i = path.length - 1; i > 0; i--) {
    if (!fn(path[i], path[i - 1]))
      return i; // If nodeIndex >= i, startOf/endOf(node) === startOf/endOf(path[path.length - 1])
  }
  return 0;
}

function isAtStartOf(node: Result, parent: Result): boolean {
  // case 1: node has leading ws
  if (node.ws && node.ws.length > 0) return false;

  // case 2: parent is sequence → check siblings before
  if (parent.type === 'sequence') {
    for (let i = 0; i < parent.value.length; i++) {
      if (parent.value[i] === node) break;
      if (lenGtZero(parent.value[i])) return false;
    }
  }

  return true;
}

function isAtEndOf(node: Result, parent: Result): boolean {
  // case 1: node has trailing ws
  if (node.type === 'root' && node.trailing_ws && node.trailing_ws.length > 0) return false;

  // case 2: parent is sequence → check siblings after
  if (parent.type === 'sequence') {
    for (let i = parent.value.length - 1; i >= 0; i--) {
      if (parent.value[i] === node) break;
      if (lenGtZero(parent.value[i])) return false;
    }
  }

  return true;
}

function lenGtZero(root: Result): boolean {
  const stack: Result[] = [root];
  let i = 0;

  while (i >= 0) {
    const r = stack[i--];

    if (r.ws && r.ws.length > 0) return true;

    switch (r.type) {
      case 'terminal':
        if (r.value != null && r.value.length > 0) return true;
        break;

      case 'state':
      case 'choice':
      case 'root':
        stack[++i] = r.value;
        break;

      case 'sequence':
      case 'iteration':
        for (let j = 0; j < r.value.length; j++) {
          stack[++i] = r.value[j];
        }
        break;

      case 'none':
      case 'rewind':
      case 'lookahead':
        break;
    }
  }

  return false;
}

export function collectPrefixDeps<K extends StateName>(
  graph: Graph<K>,
  data: Sequence<K> | Choice<K>,
  ignoreLookarounds: boolean = false
): Set<StateKey<K>> {
  const { nullable, v } = prefix(graph, data, false, ignoreLookarounds);
  return new Set(v.filter(e => typeof e === 'string'));
}

export function collectPrefixTerminals<K extends StateName>(
  graph: Graph<K>,
  data: Sequence<K> | Choice<K>,
  ignoreLookarounds: boolean = true
): Set<RegExp> {
  const { nullable, v } = prefix(graph, data, true, ignoreLookarounds);
  return new Set(v.filter(e => e instanceof RegExp));
}

type TV<K extends StateName> = StateKey<K> | RegExp;

export function prefix<K extends StateName>(
  graph: Graph<K>,
  data: Sequence<K> | Choice<K>,
  follow: boolean,
  ignoreLookarounds: boolean,
  seen: string[] = []
): { nullable: boolean; v: TV<K>[]; } {
  if (data instanceof Choice)
    return prefixChoice(graph, data, follow, ignoreLookarounds, seen);
  if (data instanceof Sequence)
    return prefixSeq(graph, data, follow, ignoreLookarounds, seen);
  throw new TypeError(`Invalid data passed to 'prefix'`, { cause: data });
}

function prefixSeq<K extends StateName>(
  graph: Graph<K>,
  data: Sequence<K>,
  follow: boolean,
  ignoreLookarounds: boolean,
  seen: string[]
): { nullable: boolean; v: TV<K>[]; } {
  const { ops, body } = data.segments;
  if (ignoreLookarounds && (ops.has('&') || ops.has('!')))
    return { nullable: true, v: [] };

  let nullable = false;
  for (const op of nullableOperators)
    if (ops.has(op))
      nullable = true;

  const output: TV<K>[] = [];
  for (const term of body) {
    if (term instanceof RegExp) {
      output.push(term);
      if (!nullableRegex(term)) {
        return { nullable, v: output };
      }
    } else if (typeof term === 'string') {
      if (!isGeneric(term)) {
        output.push(term);
        if (follow) {
          if (!seen.includes(term)) {
            const result = prefix(graph, graph.get(term)!, follow, ignoreLookarounds, [...seen, term]);
            output.push(...result.v);
            if (!result.nullable)
              return { nullable, v: output };
          }
        } else if (isSolid(graph, graph.get(term)!, [term]))
          return { nullable, v: output };
      }
    } else {
      const result = prefix(graph, term, follow, ignoreLookarounds, seen);
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
  ignoreLookarounds: boolean,
  seen: string[]
): { nullable: boolean; v: TV<K>[]; } {
  const { ops, body } = data.segments;
  if (ignoreLookarounds && (ops.has('&') || ops.has('!')))
    return { nullable: true, v: [] };

  let nullable = false;
  for (const op of nullableOperators)
    if (ops.has(op))
      nullable = true;

  let v: TV<K>[] = [];

  for (const term of body) {
    let result: { nullable: boolean; v: TV<K>[]; };

    if (term instanceof RegExp) {
      result = { nullable: nullableRegex(term), v: [term] };

    } else if (typeof term === 'string') {
      if (isGeneric(term)) {
        result = { nullable: true, v: [] };
      } else if (follow) {
        result = seen.includes(term) ?
          { nullable: true, v: [term] } :
          prefix(graph, graph.get(term)!, follow, ignoreLookarounds, [...seen, term]);
      } else {
        const solid = isSolid(graph, graph.get(term)!, [term]);
        result = {
          nullable: !solid,
          v: [term]
        };
      }

    } else {
      result = prefix(graph, term, follow, ignoreLookarounds, seen);
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
export function isSolid<K extends StateName>(
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
      if (!nullableRegex(term)) {
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

export function nullableRegex(re: RegExp) { 
  if (re.sticky) { 
    re.lastIndex = 0;
  }
  return re.test('');
}
