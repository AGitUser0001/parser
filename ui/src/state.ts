import { emit, Graph, Semantics, toParseTree, dsl, build, input_to_graph, tokenize, ParseFailedError, nodeFromJSON, graph_to_input } from '../parser_dist/index.js';
import type { Parser, Result, RootNode, StateName, States, TokenizerToken } from '../parser_dist/index.js';
export interface Handle<T extends string> {
  type: T;
  id: bigint;
}

export interface State {
  dispose(handle: Handle<'parser' | 'semantics'>): Promise<void>;
  compile(input: string, skipWsJs: string): Promise<{ states: MutableStates<StateName>, graph: Graph<StateName>, parser: Handle<'parser'> }>;
  parse(parser: Handle<'parser'>, input: string, start: string, ...ws_args: any[]): Promise<{
    result: Result & { type: 'root' };
    parseTree: RootNode;
    tokens: TokenizerToken[];
  }>;
  compileSemantics(graph: Graph<StateName>, jsCode: string, enable_memoization?: boolean): Promise<Handle<'semantics'>>;
  runSemantics(semantics: Handle<'semantics'>, parseTree: RootNode, jsCtx: string): Promise<unknown>;
  emit(parser: Handle<'parser'>): Promise<string>;
}

export class LocalState implements State {
  #parsers: Map<bigint, Parser<StateName, any>> = new Map();
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

  async compile(input: string, skipWsJs: string) {
    const skipWsFn: SkipWsBuilder<StateName, any, any> | undefined = eval(skipWsJs);
    const states = dsl.load(input);
    const graph = input_to_graph(states);
    const parser = skipWsFn ? build(graph, true, skipWsFn) : build(graph, true);
    const parserHandle = this.#mapHandle(this.#parsers, 'parser', parser);

    return { states, graph, parser: parserHandle };
  }

  async parse(parser: Handle<'parser'>, input: string, start: string, ...ws_args: any[]) {
    const parserFn = this.#readHandle(this.#parsers, parser);
    const result = parserFn(input, start, ...ws_args);
    const parseTree = toParseTree(result, false);
    const tokens = tokenize(result);

    return { result, parseTree, tokens };
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
import type { WorkerStateHandler } from './worker/worker.js';
import type { MutableStates } from '../parser_dist/graph.js';
import type { SkipWsBuilder } from '../parser_dist/parser.js';

{
  const throwHandler = Comlink.transferHandlers.get("throw")!;
  Comlink.transferHandlers.set('throw', {
    canHandle: throwHandler.canHandle,
    serialize: (o: { value: any }) => {
      const v = o.value;
      if (v instanceof ParseFailedError)
        return [{
          isParseFailedError: true,
          message: v.message,
          name: v.name,
          stack: v.stack,
          cause: v.cause
        }, []];
      return throwHandler.serialize(o);
    },
    deserialize: (data: any) => {
      if ('isParseFailedError' in data) {
        const { message, name, stack, cause }: {
          message: ParseFailedError['message'],
          name: ParseFailedError['name'],
          stack: ParseFailedError['stack'],
          cause: ParseFailedError['cause']
        } = data;
        const error = new ParseFailedError(message, { cause });
        error.name = name;
        error.stack = stack;
        throw error;
      }
      return throwHandler.deserialize(data);
    }
  });
}

Comlink.transferHandlers.set('Graph', {
  canHandle: (obj) => obj instanceof Graph,
  serialize: (obj: Graph<StateName>) => {
    return [graph_to_input(obj), []];
  },
  deserialize: (obj: States<StateName>) => {
    return input_to_graph(obj);
  }
});

export class WorkerState implements State {
  #WorkerState: Comlink.Remote<WorkerStateHandler>;
  constructor() {
    const worker = new Worker(new URL('./worker/worker.js', import.meta.url), {
      type: 'module'
    });
    this.#WorkerState = Comlink.wrap<WorkerStateHandler>(worker);
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


  async compile(input: string, skipWsJs: string) {
    const { states, graph, parser } = await this.#WorkerState.compile(input, skipWsJs);
    return { states, graph: input_to_graph(graph), parser };
  }

  async parse(parser: Handle<'parser'>, input: string, start: string, ...ws_args: any[]) {
    const { result, parseTree, tokens } = await this.#WorkerState.parse(parser, input, start, ...ws_args);
    return { result, parseTree: nodeFromJSON(parseTree), tokens };
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
    if (token === null)
      token = globalToken++;
    if (token < this.#token)
      return false;
    // if (token === this.#token)
    //   throw new Error('MergeStream Conflict: tried to send update twice with same token', {
    //     cause: { value, token }
    //   });
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

  update(values: Iterable<{
    [K in keyof O]: [K, O[K] | undefined]
  }[keyof O]>, token: bigint | null) {
    if (token === null)
      token = globalToken++;
    for (const [label, value] of values) { 
      if (token < (this.#tokens[label] ?? -1n))
        return false;
      // if (token === (this.#tokens[label] ?? -1n))
      //   throw new Error('MergeStream Conflict: tried to send update twice to same label with same token', {
      //     cause: { label, value, token }
      //   });
      this.#tokens[label] = token;
      this.#values[label] = value;
    }

    const data = { ...this.#values };
    for (const cb of this.#subs)
      cb(data, token);

    return true;
  }
}
