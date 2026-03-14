import { emit, Graph, Semantics, toParseTree, dsl, build, input_to_graph, tokenize, ParseFailedError, nodeFromJSON, graph_to_input, type States } from '../parser_dist/index.js';
import type { Parser, Result, RootNode, StateName } from '../parser_dist/index.js';
export interface Handle<T extends string> {
  type: T;
  id: bigint;
}

export class State {
  #parsers: Map<bigint, Parser<StateName>> = new Map();
  #semantics: Map<bigint, Semantics<StateName, unknown, unknown>> = new Map();
  #count = 0n;
  #mapHandle<T extends string, O>(map: Map<bigint, O>, type: T, value: O) {
    const id = this.#count++;
    const handle: Handle<T> = {
      type, id
    }
    map.set(id, value);
    return handle;
  }
  #readHandle<O>(map: Map<bigint, O>, handle: Handle<string>) {
    if (!map.has(handle.id))
      throw new Error('Cannot read disposed or invalid handle!', { cause: handle });
    return map.get(handle.id) as O;
  }
  async dispose(handle: Handle<'parser' | 'semantics'>) {
    if (handle.type === 'parser')
      this.#parsers.delete(handle.id);
    else if (handle.type === 'semantics')
      this.#semantics.delete(handle.id);
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
    const parseTree = await this.toParseTree(result);
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
    const fn = new Function(jsCode);
    const semantics = new Semantics(graph, fn(), enable_memoization);
    const semanticsHandle = this.#mapHandle(this.#semantics, 'semantics', semantics);
    return semanticsHandle;
  }

  async runSemantics(semantics: Handle<'semantics'>, parseTree: RootNode, jsCtx: string): Promise<unknown> {
    const semanticsO = this.#readHandle(this.#semantics, semantics);
    const fn = new Function(jsCtx);
    return semanticsO.evaluate(parseTree, fn());
  }

  async emit(parser: Handle<'parser'>): Promise<string> {
    const parserFn = this.#readHandle(this.#parsers, parser);
    return emit(parserFn);
  }
}

import * as Comlink from 'comlink';
import type { WorkerState } from './worker/worker.js';

Comlink.transferHandlers.set('ParseFailedError', {
  canHandle: (obj) => obj instanceof ParseFailedError,
  serialize: (obj: ParseFailedError) => {
    return [{
      message: obj.message,
      name: obj.name,
      stack: obj.stack,
      cause: obj.cause
    }, []];
  },
  deserialize: ({ message, name, stack, cause }: {
    message: ParseFailedError['message'],
    name: ParseFailedError['name'],
    stack: ParseFailedError['stack'],
    cause: ParseFailedError['cause']
  }) => {
    const error = new ParseFailedError(message, { cause });
    error.name = name;
    error.stack = stack;
    return error;
  }
});

Comlink.transferHandlers.set('Graph', {
  canHandle: (obj) => obj instanceof Graph,
  serialize: (obj: Graph<StateName>) => {
    return [graph_to_input(obj), []];
  },
  deserialize: (obj: States<StateName>) => {
    return input_to_graph(obj);
  }
});

export class WorkerStateProxy {
  #WorkerState;
  constructor() {
    const worker = new Worker(new URL('./worker/worker.js', import.meta.url), {
      type: 'module'
    });
    this.#WorkerState = Comlink.wrap<WorkerState>(worker);
  }
  #semantics: Map<bigint, Semantics<StateName, unknown, unknown>> = new Map();
  #count = 0n;
  #mapHandle<T extends string, O>(map: Map<bigint, O>, type: T, value: O) {
    const id = this.#count++;
    const handle: Handle<T> = {
      type, id
    }
    map.set(id, value);
    return handle;
  }
  #readHandle<O>(map: Map<bigint, O>, handle: Handle<string>) {
    if (!map.has(handle.id))
      throw new Error('Cannot read disposed or invalid handle!', { cause: handle });
    return map.get(handle.id) as O;
  }
  async dispose(handle: Handle<'parser'> | Handle<'semantics'>) {
    if (handle.type === 'parser')
      this.#WorkerState.dispose(handle);
    else if (handle.type === 'semantics')
      this.#semantics.delete(handle.id);
  }


  async compile(input: string) {
    const { states, graph, parser } = await this.#WorkerState.compile(input);
    return { states, graph: input_to_graph(graph), parser };
  }

  async parse(parser: Handle<'parser'>, input: string, start: string, ws?: RegExp) {
    const { result, parseTree, tokens } = await this.#WorkerState.parse(parser, input, start, ws);
    return { result, parseTree: nodeFromJSON(parseTree), tokens };
  }

  async tokenize(result: Result) {
    return this.#WorkerState.tokenize(result);
  }

  async toParseTree(result: Result) {
    return nodeFromJSON(await this.#WorkerState.toParseTreeJSON(result));
  }

  async compileSemantics(graph: Graph<StateName>, jsCode: string, enable_memoization: boolean = false) {
    const fn = new Function(jsCode);
    const semantics = new Semantics(graph, fn(), enable_memoization);
    const semanticsHandle = this.#mapHandle(this.#semantics, 'semantics', semantics);
    return semanticsHandle;
  }

  async runSemantics(semantics: Handle<'semantics'>, parseTree: RootNode, jsCtx: string): Promise<unknown> {
    const semanticsO = this.#readHandle(this.#semantics, semantics);
    const fn = new Function(jsCtx);
    return semanticsO.evaluate(parseTree, fn());
  }

  async emit(parser: Handle<'parser'>): Promise<string> {
    return this.#WorkerState.emit(parser);
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

export class MergeStream<O extends Record<string, unknown>> {
  #subs: ((value: Partial<O>, token: bigint) => void)[] = [];
  #values: Partial<O> = Object.create(null);
  #tokens: Partial<Record<keyof O, bigint>> = Object.create(null);

  subscribe(...cbs: ((value: Partial<O>, token: bigint) => void)[]) {
    this.#subs.push(...cbs);
  }

  update<K extends keyof O>(label: K, value: O[K] | undefined, token: bigint | null) {
    if (token === null) {
      token = globalToken++;
    } else {
      if (token <= (this.#tokens[label] ?? -1n))
        return false;
    }
    this.#tokens[label] = token;
    this.#values[label] = value;

    const data = { ...this.#values };
    for (const cb of this.#subs)
      cb(data, token);

    return true;
  }
}
