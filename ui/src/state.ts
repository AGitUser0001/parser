import { emit, Graph, Semantics, toParseTree, dsl, build, input_to_graph, tokenize } from '../../src/index.js';
import type { Parser, Result, TokenizerToken, RootNode, StateName, States } from '../../src/index.js';
export class State {
  input: string = "";
  states: States<StateName> | null = null;
  graph: Graph<StateName> | null = null;
  parser: Parser<StateName> | null = null;

  result: Result | null = null;
  parseTree: RootNode | null = null;
  tokens: TokenizerToken[] | null = null;

  semantics: Semantics<StateName, unknown, unknown> | null = null;
  semanticsResult: unknown = undefined;

  async compile(): Promise<void> {
    // Stage 1: DSL → states
    const states = dsl.load(this.input);

    this.states = states;

    // reset downstream
    this.graph = null;
    this.parser = null;
    this.result = null;
    this.parseTree = null;
    this.semantics = null;
    this.tokens = null;
    this.semanticsResult = undefined;

    // Stage 2: states → graph
    const graph = input_to_graph(states);
    this.graph = graph;

    // Stage 3: graph → parser
    const parser = build(graph, true);
    this.parser = parser;
  }

  async parse(input: string, start: string, ws?: RegExp): Promise<void> {
    if (this.parser == null)
      throw new Error('Failed parsing: no parser.');
    this.result = this.parser(input, start, ws);
    this.parseTree = null;
    this.tokens = null;
    this.semanticsResult = undefined;
  }

  async tokenize(): Promise<void> {
    if (this.result == null)
      throw new Error('Failed generating tokens: no CST.');
    this.tokens = tokenize(this.result);
  }

  async toParseTree(): Promise<void> {
    if (this.result == null)
      throw new Error('Failed generating parse tree: no CST.');
    this.parseTree = toParseTree(this.result);
    this.semanticsResult = undefined;
  }

  async compileSemantics(jsCode: string, enable_memoization: boolean = false): Promise<void> {
    if (this.graph == null)
      throw new Error('Failed compiling semantics: no graph.');
    this.semantics = new Semantics(this.graph, eval(jsCode), enable_memoization);
  }

  async runSemantics(jsCtx: string): Promise<void> {
    if (this.semantics == null)
      throw new Error('Failed evaluating semantics: no semantics.');
    if (this.parseTree == null)
      throw new Error('Failed evaluating semantics: no parse tree.');
    this.semanticsResult = this.semantics.evaluate(this.parseTree, eval(jsCtx));
  }

  async emit(): Promise<string> {
    if (this.parser == null)
      throw new Error('Failed emitting: no parser.');
    return emit(this.parser);
  }
} 
