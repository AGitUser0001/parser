import * as Comlink from '../../../node_modules/comlink/dist/esm/comlink.js';

import { emit, toParseTree, dsl, build, input_to_graph, tokenize, ParseFailedError, nodeToJSON, graph_to_input } from '../../parser_dist/index.js';
import type { Parser, StateName } from '../../parser_dist/index.js';
import type { SkipWsBuilder } from '../../parser_dist/parser.js';
import type { Handle } from '../state.js';

export class WorkerStateHandler {
  #parsers: Map<bigint, Parser<StateName, any>> = new Map();
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

  compile(input: string, skipWsJs: string) {
    const fn = new Function(`return (${skipWsJs})`);
    const skipWsFn: SkipWsBuilder<StateName, any, any> | undefined = fn();
    const states = dsl.load(input);
    const graph = input_to_graph(states);
    const parser = skipWsFn ? build(graph, true, skipWsFn) : build(graph, true);
    const parserHandle = this.#mapHandle(this.#parsers, 'parser', parser);

    return { states, graph: graph_to_input(graph), parser: parserHandle };
  }

  parse(parser: Handle<'parser'>, input: string, start: string, ...ws_args: any[]) {
    const parserFn = this.#readHandle(this.#parsers, parser);
    const result = parserFn(input, start, ...ws_args);
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

Comlink.expose(new WorkerStateHandler());
