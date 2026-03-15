import * as Comlink from '../../../node_modules/comlink/dist/esm/comlink.js';

import { emit, toParseTree, dsl, build, input_to_graph, tokenize, ParseFailedError, nodeToJSON, graph_to_input } from '../../parser_dist/index.js';
import type { Parser, StateName } from '../../parser_dist/index.js';
import type { Handle } from '../state.js';

export class WorkerStateHandler {
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
  dispose(handle: Handle<'parser'>) {
    if (handle.type === 'parser')
      this.#parsers.delete(handle.id);
  }

  compile(input: string) {
    const states = dsl.load(input);
    const graph = input_to_graph(states);
    const parser = build(graph, true);
    const parserHandle = this.#mapHandle(this.#parsers, 'parser', parser);

    return { states, graph: graph_to_input(graph), parser: parserHandle };
  }

  parse(parser: Handle<'parser'>, input: string, start: string, ws?: RegExp) {
    const parserFn = this.#readHandle(this.#parsers, parser);
    const result = parserFn(input, start, ws);
    const parseTree = nodeToJSON(toParseTree(result, false));
    const tokens = tokenize(result);

    return { result, parseTree, tokens };
  }

  /*
  compileSemantics(graph: Graph<StateName>, jsCode: string, enable_memoization: boolean = false) {
    const fn = new Function(jsCode);
    const semantics = new Semantics(graph, fn(), enable_memoization);
    const semanticsHandle = this.#mapHandle(this.#semantics, 'semantics', semantics);
    return semanticsHandle;
  }

  runSemantics(semantics: Handle<'semantics'>, parseTree: RootNode, jsCtx: string): unknown {
    const semanticsO = this.#readHandle(this.#semantics, semantics);
    const fn = new Function(jsCtx);
    return semanticsO.evaluate(parseTree, fn());
  }
  */

  emit(parser: Handle<'parser'>): string {
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

Comlink.expose(new WorkerStateHandler());
