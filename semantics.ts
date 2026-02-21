import { StateNode, IterationNode, TerminalNode, type AnyASTNode, transformCSTRoot, toTypedAST, RootNode, Source } from './ast.js';
import { type StateName, type StateKey, Graph } from './graph.js';
import { MapView, type DeepReplace, type UnionToIntersection, type Display } from './shared.js';
import { parse } from './parser.js';

type AllASTNodes_ = UnionToIntersection<AnyASTNode>;
export type AllASTNodes = Display<
  DeepReplace<AllASTNodes_, [Source, Source] | [AnyASTNode[], AllASTNodes[]] | [AnyASTNode[][], AllASTNodes[][]]>
>;
export interface SemanticsThis<K extends StateName, R, C> {
  (node: AnyASTNode): R;
  with(node: AnyASTNode, ctx: C): R;
  use: {
    (key: SemanticsKey<K>, ...args: AnyASTNode[]): R;
    with(key: SemanticsKey<K>, ctx: C, ...args: AnyASTNode[]): R;
  };
  readonly node: AllASTNodes;
  readonly ctx: C;
};

export type SemanticFn<K extends StateName, R, C> =
  (this: SemanticsThis<K, R, C>, ...args: AllASTNodes[]) => R;

export type SpecialKey = '#iter' | '#terminal' | '#root';

export type SemanticsKey<K extends StateName> = StateKey<K> | SpecialKey;

export type SemanticsSpec<K extends StateName, R, C> = {
  [Key in SemanticsKey<K>]?: SemanticFn<K, R, C>;
};

export class Semantics<K extends StateName, R = any, C = void> extends MapView<SemanticsKey<K>, SemanticFn<K, R, C>> {
  readonly name: string;
  #memo?: WeakMap<AnyASTNode, R>;
  constructor(
    name: string,
    graph: Graph<K>,
    spec: SemanticsSpec<K, R, C>,
    // memoization assumes that the ctx will be the same each time
    // there is NO check
    enable_memoization = false
  ) {
    const map = new Map<SemanticsKey<K>, SemanticFn<K, R, C>>();
    const stateLabels = Object.keys(spec) as SemanticsKey<K>[];

    for (const stateLabel of stateLabels) {
      let value = spec[stateLabel];
      if (!value) continue;

      const fn: SemanticFn<K, R, C> = value;
      map.set(stateLabel, fn);
      let expected: number;
      switch (stateLabel) {
        case '#iter':
          continue;
        case '#root':
        case '#terminal':
          expected = 1;
          break;
        default:
          if (!graph.has(stateLabel))
            throw new Error(
              `[${name}] Semantic defined for unknown state: ${stateLabel}`
            );
          const seq = graph.get(stateLabel)!;
          expected = seq.arity;
          break;
      }

      const actual = fn.length;

      if (actual !== expected) {
        throw new Error(
          `[${name}] Arity mismatch for ${stateLabel}: expected ${expected}, got ${actual}`
        );
      }
    }

    super(map);
    this.name = name;
    if (enable_memoization) {
      this.#memo = new WeakMap();
    }
  }

  static create<K extends StateName, R = any, C = void>(
    name: string,
    graph: Graph<K>,
    spec: SemanticsSpec<K, R, C>,
    enable_memoization = false
  ) {
    return new Semantics<K, R, C>(name, graph, spec, enable_memoization);
  }
  static for<K extends StateName>(graph: Graph<K>) {
    const result = <R = any, C = void>(
      name: string,
      spec: SemanticsSpec<K, R, C>,
      enable_memoization = false
    ) =>
      Semantics.create<K, R, C>(name, graph, spec, enable_memoization);
    const withFn = <C>() => {
      const result = <R = any>(
        name: string,
        spec: SemanticsSpec<K, R, C>,
        enable_memoization = false
      ) =>
        Semantics.create<K, R, C>(name, graph, spec, enable_memoization);
      result.returns = <R>() => (
        name: string,
        spec: SemanticsSpec<K, R, C>,
        enable_memoization = false
      ) =>
        Semantics.create<K, R, C>(name, graph, spec, enable_memoization);
      return result;
    };
    result.with = withFn;
    result.returns = <R>() => {
      const result = <C = void>(
        name: string,
        spec: SemanticsSpec<K, R, C>,
        enable_memoization = false
      ) =>
        Semantics.create<K, R, C>(name, graph, spec, enable_memoization);
      result.with = <C>() => withFn<C>().returns<R>();
      return result;
    };
    return result;
  }
  static with<C>() {
    const result = <K extends StateName, R = any>(
      name: string,
      graph: Graph<K>,
      spec: SemanticsSpec<K, R, C>,
      enable_memoization = false
    ) =>
      Semantics.create<K, R, C>(name, graph, spec, enable_memoization);
    result.for = <K extends StateName>(graph: Graph<K>) =>
      Semantics.for<K>(graph).with<C>();
    result.returns = <R>() => {
      const result = <K extends StateName>(
        name: string,
        graph: Graph<K>,
        spec: SemanticsSpec<K, R, C>,
        enable_memoization = false
      ) =>
        Semantics.create<K, R, C>(name, graph, spec, enable_memoization);
      result.for = <K extends StateName>(graph: Graph<K>) =>
        Semantics.for<K>(graph).with<C>().returns<R>();
    };
    return result;
  }
  static returns<R>() {
    const result = <K extends StateName, C = void>(
      name: string,
      graph: Graph<K>,
      spec: SemanticsSpec<K, R, C>,
      enable_memoization = false
    ) =>
      Semantics.create<K, R, C>(name, graph, spec, enable_memoization);
    result.for = <K extends StateName>(graph: Graph<K>) =>
      Semantics.for<K>(graph).returns<R>();
    result.with = <C>() => Semantics.with<C>().returns<R>();
    return result;
  }

  parse(graph: Graph<K>, input: string, start: StateKey<K>, ctx: C, ws?: RegExp) {
    const result = parse(graph, input, start, ws);
    const astIR = transformCSTRoot(result);
    const typedAST = toTypedAST(astIR);
    const data = this.evaluate(typedAST, ctx);
    return data;
  }

  evaluate(node: AnyASTNode, ctx: C): R {
    return this.#descend(node, ctx);
  }

  #evalState(node: StateNode, ctx: C): R {
    /**
     * Semantic resolution:
     * 
     * 1. Try exact match: 'Items@0'
     * 2. Strip suffix: 'Items' (For instantiated generics like 'Items@0', 'Items@1')
     * 3. Fall back to attribute target if available
     * 4. Fall through to single child if arity=1
     */

    let stateLabel = node.state as StateKey<K>;
    let fn = this.get(stateLabel);
    while (!fn && stateLabel.includes('@')) {
      const lastAt = stateLabel.lastIndexOf('@');
      stateLabel = stateLabel.slice(0, lastAt) as StateKey<K>;
      fn = this.get(stateLabel);
    }
    if (!fn) {
      const linkedNode = node.attributeMap.get(this.name);
      if (linkedNode) {
        return this.#descend(linkedNode, ctx);
      }
      if (node.children.length === 1) {
        if (node.children[0] instanceof StateNode)
          return this.#descend(node.children[0], ctx);
      }
      throw new Error(
        `[${this.name}] No semantics defined for state: ${stateLabel}`,
        { cause: { node, stateLabel } }
      );
    }

    if (node.children.length !== fn.length) {
      throw new Error(
        `[${this.name}] Runtime arity mismatch for ${stateLabel}: ` +
        `expected ${fn.length}, got: ${node.children.length}`,
        { cause: { node, stateLabel, fn } }
      );
    }

    return this.#run(node, fn, ctx);
  }

  #use(node: AnyASTNode, key: SemanticsKey<K>, ctx: C, args: AnyASTNode[]): R {
    let fn = this.get(key);
    while (!fn && key.includes('@')) {
      const lastAt = key.lastIndexOf('@');
      key = key.slice(0, lastAt) as SemanticsKey<K>;
      fn = this.get(key);
    }
    if (!fn)
      throw new Error(
        `[${this.name}] Semantics.use: No semantics defined: ${key}`,
        { cause: { node, key, args } }
      );
    if (args.length !== fn.length) {
      throw new Error(
        `[${this.name}] Semantics.use: Arity mismatch for ${key}: ` +
        `expected ${fn.length}, got: ${args.length}`,
        { cause: { node, key, args, fn } }
      );
    }

    return this.#run(node, fn, ctx, args);
  }

  #evalIteration(node: IterationNode, ctx: C): R {
    const fn = this.get('#iter');
    if (!fn) {
      throw new Error(
        `[${this.name}] Cannot evaluate iteration node: no semantics defined for iteration nodes ('#iter').`,
        { cause: node }
      );
    }

    return this.#run(node, fn, ctx);
  }

  #evalTerminal(node: TerminalNode, ctx: C): R {
    const fn = this.get('#terminal');
    if (!fn) {
      throw new Error(
        `[${this.name}] Cannot evaluate terminal node: no semantics defined for terminal nodes ('#terminal').`,
        { cause: node }
      );
    }

    return this.#run(node, fn, ctx, [node]);
  }

  #evalRoot(node: RootNode, ctx: C): R {
    if (node.children.length !== 1)
      throw new Error(
        `[${this.name}] Cannot evaluate root node: wrong number of children: ${node.children.length}.`,
        { cause: node }
      );
    const fn = this.get('#root');
    if (!fn) {
      return this.#descend(node.children[0], ctx);
    }

    return this.#run(node, fn, ctx);
  }

  #run(node: AnyASTNode, fn: SemanticFn<K, R, C>, ctx: C, data = node.children) {
    const self = (node: AnyASTNode) => this.#descend(node, ctx);
    self.with = (node: AnyASTNode, ctx: C) => this.#descend(node, ctx);

    const use = (key: SemanticsKey<K>, ...args: AnyASTNode[]) =>
      this.#use(node, key, ctx, args);
    use.with = (key: SemanticsKey<K>, ctx: C, ...args: AnyASTNode[]) =>
      this.#use(node, key, ctx, args);

    self.use = use;
    self.ctx = ctx;
    self.node = node as AllASTNodes;

    return fn.apply(self, data as AllASTNodes[]);
  }

  #descend(node: AnyASTNode, ctx: C): R {
    const memo = this.#memo;
    if (memo?.has(node))
      return memo.get(node)!;

    let result: R;
    if (node instanceof StateNode)
      result = this.#evalState(node, ctx);

    else if (node instanceof IterationNode)
      result = this.#evalIteration(node, ctx);

    else if (node instanceof TerminalNode)
      result = this.#evalTerminal(node, ctx);

    else if (node instanceof RootNode)
      result = this.#evalRoot(node, ctx);

    else {
      const _exhaustive: never = node;
      throw new Error(
        `[${this.name}] Cannot evaluate unknown node`,
        { cause: node }
      );
    }

    memo?.set(node, result);
    return result;
  }
}
