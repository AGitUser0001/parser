import * as Comlink from '../../../node_modules/comlink/dist/esm/comlink.js';

import { emit, Graph, Semantics, toParseTree, dsl, build, input_to_graph, tokenize, ParseFailedError, nodeToJSON, graph_to_input, type States, type RootRepresentation } from '../../parser_dist/index.js';
import type { Parser, Result, RootNode, StateName } from '../../parser_dist/index.js';
import type { Handle } from '../state.js';

export class WorkerState {
  #parsers: Map<bigint, Parser<StateName>> = new Map();
  // #semantics: Map<bigint, Semantics<StateName, unknown, unknown>> = new Map();
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
  async dispose(handle: Handle<'parser'>) {
    if (handle.type === 'parser')
      this.#parsers.delete(handle.id);
  }

  async compile(input: string) {
    const states = dsl.load(input);
    const graph = input_to_graph(states);
    const parser = build(graph, true);
    const parserHandle = this.#mapHandle(this.#parsers, 'parser', parser);

    return { states, graph: graph_to_input(graph), parser: parserHandle };
  }

  async parse(parser: Handle<'parser'>, input: string, start: string, ws?: RegExp) {
    const parserFn = this.#readHandle(this.#parsers, parser);
    const result = parserFn(input, start, ws);
    const parseTree = await this.toParseTreeJSON(result);
    const tokens = tokenize(result);

    return { result, parseTree, tokens };
  }

  async tokenize(result: Result) {
    return tokenize(result);
  }

  async toParseTreeJSON(result: Result): Promise<RootRepresentation> {
    return nodeToJSON(toParseTree(result, false));
  }

  /*
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
  */

  async emit(parser: Handle<'parser'>): Promise<string> {
    const parserFn = this.#readHandle(this.#parsers, parser);
    return emit(parserFn);
  }
}

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

Comlink.expose(new WorkerState());
