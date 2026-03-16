import { Graph, type StateKey, type StateName } from './graph.js';
import { collectPrefixDeps } from './analyze.js';

type DepGraph<K extends StateName> = Map<StateKey<K>, Set<StateKey<K>>>;

function buildDependencyGraph<K extends StateName>(
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

function computeSCCs<K extends StateName>(
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
