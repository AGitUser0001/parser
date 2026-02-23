import { Graph, Choice, Sequence, type StateKey, type StateName, type StandaloneOperator, isGeneric,OP_MAP } from './graph.js';

export type DepGraph<K extends StateName> = Map<StateKey<K>, Set<StateKey<K>>>;

export function collectPrefixDeps<K extends StateName>(
  graph: Graph<K>,
  data: Sequence<K>
): Set<StateKey<K>> {
  const { nullable, deps } = prefixDeps(graph, data);
  return new Set(deps);
}

export function prefixDeps<K extends StateName>(
  graph: Graph<K>,
  data: Sequence<K>
): { nullable: boolean; deps: StateKey<K>[]; } {
  const [opMask, attrs, body] = data.operators;
  let nullable = false;
  for (const op of nullableOperators)
    if (opMask & OP_MAP[op])
      nullable = true;

  const output: StateKey<K>[] = [];
  for (const term of body) {
    if (term instanceof RegExp) {
      term.lastIndex = 0;
      if (!term.test('')) {
        return { nullable, deps: output };
      }
    } else if (typeof term === 'string') {
      if (!isGeneric(term)) {
        output.push(term);
        if (isSolid(graph, graph.get(term)!, [term]))
          return { nullable, deps: output };
      }
    } else if (term instanceof Choice) {
      const result = prefixDepsChoice(graph, term);
      output.push(...result.deps);
      if (!result.nullable)
        return { nullable, deps: output };
    } else {
      const result = prefixDeps(graph, term);
      output.push(...result.deps);
      if (!result.nullable)
        return { nullable, deps: output };
    }
  }
  return { nullable: true, deps: output };
}

export function prefixDepsChoice<K extends StateName>(
  graph: Graph<K>,
  data: Choice<K>
): { nullable: boolean; deps: StateKey<K>[]; } {
  const [opMask, attrs, body] = data.operators;

  let nullable = false;
  for (const op of nullableOperators)
    if (opMask & OP_MAP[op])
      nullable = true;

  let deps: StateKey<K>[] = [];

  for (const term of body) {
    let result: { nullable: boolean; deps: StateKey<K>[]; };

    if (term instanceof RegExp) {
      term.lastIndex = 0;
      result = { nullable: term.test(''), deps: [] };

    } else if (typeof term === 'string') {
      if (isGeneric(term)) {
        result = { nullable: true, deps: [] };
      } else {
        const solid = isSolid(graph, graph.get(term)!, [term]);
        result = {
          nullable: !solid,
          deps: [term]
        };
      }

    } else if (term instanceof Choice) {
      result = prefixDepsChoice(graph, term);

    } else {
      result = prefixDeps(graph, term);
    }

    nullable ||= result.nullable;
    deps.push(...result.deps);
  }

  return {
    nullable,
    deps
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
  const [opMask, attrs, body] = data.operators;
  for (const op of nullableOperators)
    if (opMask & OP_MAP[op])
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

export function buildDependencyGraph<K extends StateName>(
  graph: Graph<K>
): DepGraph<K> {
  const deps: DepGraph<K> = new Map();

  for (const [key, seq] of graph) {
    const set = collectPrefixDeps(graph, seq);
    deps.set(key, set);
  }

  return deps;
}

export type SccId = number;

export function computeSCCs<K extends StateName>(
  depGraph: DepGraph<K>
): SCCInfo<K> {
  let index = 0;
  const stack: StateKey<K>[] = [];
  const onStack = new Set<StateKey<K>>();

  const indexOf = new Map<StateKey<K>, number>();
  const lowlink = new Map<StateKey<K>, number>();

  const sccOf = new Map<StateKey<K>, SccId>();
  const sccMembers = new Map<SccId, StateKey<K>[]>();
  let sccCount = 0;

  function strongconnect(v: StateKey<K>) {
    indexOf.set(v, index);
    lowlink.set(v, index);
    index++;

    stack.push(v);
    onStack.add(v);

    for (const w of depGraph.get(v)!) {
      if (!indexOf.has(w)) {
        strongconnect(w);
        lowlink.set(
          v,
          Math.min(lowlink.get(v)!, lowlink.get(w)!)
        );
      } else if (onStack.has(w)) {
        lowlink.set(
          v,
          Math.min(lowlink.get(v)!, indexOf.get(w)!)
        );
      }
    }

    if (lowlink.get(v) === indexOf.get(v)) {
      const group: StateKey<K>[] = [];

      while (true) {
        const w = stack.pop()!;
        onStack.delete(w);
        group.push(w);
        if (w === v) break;
      }

      // Only keep SCC if it's a real cycle
      const isCycle =
        group.length > 1 ||
        depGraph.get(group[0])?.has(group[0]);

      if (isCycle) {
        const id = sccCount++;
        for (const w of group) {
          sccOf.set(w, id);
        }
        sccMembers.set(id, group);
      }
    }
  }

  for (const v of depGraph.keys()) {
    if (!indexOf.has(v)) {
      strongconnect(v);
    }
  }

  return { sccOf, sccMembers };
}

export type SCCInfo<K extends StateName> = {
  sccOf: Map<StateKey<K>, SccId>;
  sccMembers: Map<SccId, StateKey<K>[]>;
};

export function computeSCCInfo<K extends StateName>(
  graph: Graph<K>
): SCCInfo<K> {
  const depGraph = buildDependencyGraph(graph);

  const sccInfo = computeSCCs(depGraph);
  return sccInfo;
}
