import type { StateName, IterationOperator } from './graph.js';
import type { Result, MatcherValue } from './parser.js';

export type ASTResultValue =
  | ASTResult
  | ASTResult[]
  | ASTResult[][]
  | MatcherValue
  | null;

export type BaseASTResult = { value: ASTResultValue; start: number; end: number; };
export type ASTSource = { start: number; end: number; text: string; };

export type ASTResult =
  | BaseASTResult & { type: 'state'; state: StateName; value: ASTResult[]; }
  | BaseASTResult & { type: 'terminal'; value: MatcherValue; }
  | BaseASTResult & { type: 'iteration'; kind: IterationOperator; value: ASTResult[][]; }
  | BaseASTResult & { type: 'root'; value: ASTResult & { type: 'state'; }; source: ASTSource; };

export function transformCSTRoot(result: Result): ASTResult & { type: 'root'; } {
  if (!result.ok)
    throw new Error(`transformCSTRoot: Got failing result`, { cause: result });
  const out: ASTResult[] = [];
  let sourceCon: ASTSourceCon = { text: [] };
  transformCST(result, out, sourceCon);
  if (out.length !== 1)
    throw new Error(`transformCSTRoot: Got invalid data`, { cause: { out, result } });
  if (out[0].type !== 'state')
    throw new Error(`transformCSTRoot: Got transformed type ${out[0].type}`, { cause: result });

  const source: ASTSource = {
    start: sourceCon.start ?? 0,
    end: sourceCon.end ?? 0,
    text: sourceCon.text.join('')
  };

  return {
    type: 'root',
    value: out[0],
    source: source,
    start: source.start,
    end: source.end
  };
}

export type ASTSourceCon = { start?: number; end?: number; text: string[]; };
export function transformCST(result: Result, out: ASTResult[], sourceCon: ASTSourceCon): number {
  if (!result.ok) return 0;
  let len = 0, wslen = 0;
  if (result.ws) {
    sourceCon.text.push(result.ws);
    len += result.ws.length;
    wslen = result.ws.length;
  }
  switch (result.type) {
    case 'state':
      {
        const newOut: ASTResult[] = [];
        len += transformCST(result.value, newOut, sourceCon);
        out.push({
          type: 'state',
          value: newOut,
          start: result.pos - len + wslen,
          end: result.pos,
          state: result.state
        });
      }
      break;

    case 'terminal':
      sourceCon.text.push(result.value);
      len += result.value.length;
      out.push({
        type: 'terminal',
        value: result.value,
        start: result.pos - len + wslen,
        end: result.pos
      });
      break;

    case 'iteration':
      {
        let results: ASTResult[][];
        if (!Array.isArray(result.value)) {
          const newOut: ASTResult[] = [];
          len += transformCST(result.value, newOut, sourceCon);
          results = [newOut];
        } else {
          results = Array(result.value.length);
          for (let i = 0; i < result.value.length; i++) {
            const newOut: ASTResult[] = [];
            len += transformCST(result.value[i], newOut, sourceCon);
            results[i] = newOut;
          }
        }
        out.push({
          type: 'iteration',
          value: results,
          start: result.pos - len + wslen,
          end: result.pos,
          kind: result.kind
        });
      }
      break;

    case 'sequence':
      if (!Array.isArray(result.value)) {
        len += transformCST(result.value, out, sourceCon);
      } else for (let i = 0; i < result.value.length; i++) {
        len += transformCST(result.value[i], out, sourceCon);
      }
      break;

    case 'lookahead':
      break;

    case 'root':
      if (result.trailing_ws) {
        sourceCon.text.push(result.trailing_ws);
        len += result.trailing_ws.length;
      }
    case 'choice':
    case 'rewind':
      transformCST(result.value, out, sourceCon);
      break;

    default:
      const _exhaustive: never = result;
      throw new TypeError('Invalid result!', { cause: { result, out } });
  }

  if (sourceCon.start === undefined)
    sourceCon.start = result.pos - len;
  sourceCon.end = result.pos;

  return len;
}

export abstract class ASTNode {
  constructor(
    public readonly parent: AnyASTNode | null,
    public readonly children: AnyASTNode[],
    public readonly start: number,
    public readonly end: number,
    public readonly _source: ASTSource
  ) { }

  get source() {
    return this._source.text.slice(
      this.start - this._source.start,
      this.end - this._source.start
    );
  }
}

export class RootNode extends ASTNode {
  constructor(
    parent: AnyASTNode | null,
    children: AnyASTNode[],
    start: number, end: number, source: ASTSource
  ) { super(parent, children, start, end, source); }
}

export class StateNode extends ASTNode {
  constructor(
    parent: AnyASTNode | null,
    children: AnyASTNode[],
    start: number, end: number, source: ASTSource,
    public readonly state: StateName
  ) { super(parent, children, start, end, source); }
}

export class TerminalNode extends ASTNode {
  constructor(
    parent: AnyASTNode | null,
    children: [],
    start: number, end: number, source: ASTSource,
    public readonly value: MatcherValue
  ) { super(parent, children, start, end, source); }
}

export class IterationNode extends ASTNode {
  constructor(
    parent: AnyASTNode | null,
    children: AnyASTNode[],
    start: number, end: number, source: ASTSource,
    public readonly kind: IterationOperator,
    public readonly iterations: AnyASTNode[][]
  ) { super(parent, children, start, end, source); }
}

export type AnyASTNode = RootNode | StateNode | TerminalNode | IterationNode;
export function toTypedAST(value: ASTResult & { type: 'root'; }) {
  if (!value || typeof value !== 'object')
    throw new TypeError(`Invalid value passed to toTypedAST!`, { cause: value });

  if (value.type !== 'root')
    throw new Error(`ASTResult.type: expected 'root', got: ${value.type}`, { cause: value });

  const source = value.source;
  const rootNode = new RootNode(null, [], value.start, value.end, source);
  rootNode.children.push(toTypedASTInternal(value.value, rootNode, source));
  return rootNode;
}

type OwnerNode = RootNode | StateNode | IterationNode;
function toTypedASTInternal(value: ASTResult, ownerNode: OwnerNode, source: ASTSource): AnyASTNode {
  if (!value || typeof value !== 'object')
    throw new TypeError(`Invalid value in toTypedAST!`, { cause: value });

  switch (value.type) {
    case 'state':
      const children = Array(value.value.length);
      const stateNode = new StateNode(ownerNode, children, value.start, value.end, source, value.state);
      for (let i = 0; i < value.value.length; i++) {
        children[i] = toTypedASTInternal(value.value[i], stateNode, source);
      }
      return stateNode;
    case 'terminal':
      return new TerminalNode(ownerNode, [], value.start, value.end, source, value.value);
    case 'iteration':
      const iterations: AnyASTNode[][] = Array(value.value.length);
      const iterationNode = new IterationNode(ownerNode, [], value.start, value.end, source, value.kind, iterations);
      for (let i = 0; i < value.value.length; i++) {
        const iter = value.value[i];
        const iteration = iterations[i] = Array(iter.length);
        for (let j = 0; j < iter.length; j++) {
          const transformed = toTypedASTInternal(iter[j], iterationNode, source);
          iteration[j] = transformed;
          iterationNode.children.push(transformed);
        }
      }
      return iterationNode;
    case 'root':
      throw new TypeError(`Did not expect root node!`, { cause: { value } });
    default:
      const _exhaustive: never = value;
      throw new Error(`Invalid ASTResult.type: ${(value as ASTResult).type}`, { cause: { value } });
  }
}
