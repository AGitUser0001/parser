import { emit, Graph, Semantics, toParseTree, dsl, build, input_to_graph, tokenize } from '../parser_dist/index.js';
import type { Parser, Result, RootNode, StateName } from '../parser_dist/index.js';
export interface Handle<T extends string> {
  type: T;
  id: bigint;
  dispose(): void;
}

export class State {
  #parsers: Map<bigint, Parser<StateName>> = new Map();
  #semantics: Map<bigint, Semantics<StateName, unknown, unknown>> = new Map();
  #count = 0n;
  #mapHandle<T extends string, O>(map: Map<bigint, O>, type: T, value: O) {
    const id = this.#count++;
    const handle: Handle<T> = {
      type, id,
      dispose: () => void map.delete(id)
    }
    map.set(id, value);
    return handle;
  }
  #readHandle<O>(map: Map<bigint, O>, handle: Handle<string>) {
    if (!map.has(handle.id))
      throw new Error('Cannot read disposed or invalid handle!', { cause: handle });
    return map.get(handle.id) as O;
  }

  async compile(input: string) {
    const states = dsl.load(input);
    const graph = input_to_graph(states);
    const parser = build(graph, true);
    const parserHandle = this.#mapHandle(this.#parsers, 'parser', parser);

    return { states, graph, parser: parserHandle };
  }

  async parse(parser: Handle<'parser'>, input: string, start: string, ws?: RegExp) {
    const parserFn = this.#readHandle(this.#parsers, parser);
    const result = parserFn(input, start, ws);
    const parseTree = toParseTree(result);
    const tokens = tokenize(result);

    return { result, parseTree, tokens };
  }

  async tokenize(result: Result) {
    return tokenize(result);
  }

  async toParseTree(result: Result) {
    return toParseTree(result, false);
  }

  async compileSemantics(graph: Graph<StateName>, jsCode: string, enable_memoization: boolean = false) {
    const fn = new Function(`return (${jsCode})`);
    const semantics = new Semantics(graph, fn(), enable_memoization);
    const semanticsHandle = this.#mapHandle(this.#semantics, 'semantics', semantics);
    return semanticsHandle;
  }

  async runSemantics(semantics: Handle<'semantics'>, parseTree: RootNode, jsCtx: string): Promise<unknown> {
    const semanticsO = this.#readHandle(this.#semantics, semantics);
    const fn = new Function(`return (${jsCtx})`);
    return semanticsO.evaluate(parseTree, fn());
  }

  async emit(parser: Handle<'parser'>): Promise<string> {
    const parserFn = this.#readHandle(this.#parsers, parser);
    return emit(parserFn);
  }
}

let globalToken = 0n;
export class Stream<T> {
  #subs: ((value: T, token: bigint) => void)[] = [];
  #token = -1n;

  subscribe(...cbs: ((value: T, token: bigint) => void)[]) {
    this.#subs.push(...cbs);
  }

  update(value: T, token: bigint | null) {
    if (token === null) {
      token = globalToken++;
    } else {
      if (token <= this.#token)
        return false;
    }
    this.#token = token;

    for (const cb of this.#subs)
      cb(value, token);

    return true;
  }
}
