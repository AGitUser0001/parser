import type { StateName, IterationOperator } from './graph.js';
import type { Result, MatcherValue } from './parser.js';

export type ASTResultValue =
  | ASTResult
  | ASTResult[]
  | ASTResult[][]
  | MatcherValue
  | null;

export type BaseASTResult = { value: ASTResultValue; start: number; end: number; };

export type ASTResult =
  | BaseASTResult & { type: 'state'; state: StateName; value: ASTResult[]; }
  | BaseASTResult & { type: 'terminal'; value: MatcherValue; }
  | BaseASTResult & { type: 'iteration'; kind: IterationOperator; value: ASTResult[][]; }
  | BaseASTResult & { type: 'root'; value: ASTResult & { type: 'state'; }; source: string; };

export function transformCSTRoot(result: Result): ASTResult & { type: 'root'; } {
  if (!result.ok)
    throw new Error(`transformCSTRoot: Got failing result`, { cause: result });
  const out: ASTResult[] = [];
  const text: string[] = [];
  const len = transformCST(result, out, str => text.push(str));
  if (out.length !== 1)
    throw new Error(`transformCSTRoot: Got invalid data`, { cause: { out, result } });
  if (out[0].type !== 'state')
    throw new Error(`transformCSTRoot: Got transformed type ${out[0].type}`, { cause: result });

  const sourceText = text.join('');

  return {
    type: 'root',
    value: out[0],
    source: sourceText,
    start: result.pos - len,
    end: result.pos
  };
}

export function transformCST(result: Result, out: ASTResult[], addText: (str: string) => void): number {
  if (!result.ok) return 0;
  let len = 0, wslen = 0;
  if (result.ws) {
    addText(result.ws);
    len += result.ws.length;
    wslen = result.ws.length;
  }
  switch (result.type) {
    case 'terminal':
      addText(result.value);
      len += result.value.length;
      out.push({
        type: 'terminal',
        value: result.value,
        start: result.pos - len + wslen,
        end: result.pos
      });
      break;

    case 'sequence':
      if (!Array.isArray(result.value)) {
        len += transformCST(result.value, out, addText);
      } else for (let i = 0; i < result.value.length; i++) {
        len += transformCST(result.value[i], out, addText);
      }
      break;

    case 'choice':
    case 'rewind':
      transformCST(result.value, out, addText);
      break;

    case 'iteration':
      {
        let results: ASTResult[][];
        if (!Array.isArray(result.value)) {
          const newOut: ASTResult[] = [];
          len += transformCST(result.value, newOut, addText);
          results = [newOut];
        } else {
          results = Array(result.value.length);
          for (let i = 0; i < result.value.length; i++) {
            const newOut: ASTResult[] = [];
            len += transformCST(result.value[i], newOut, addText);
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

    case 'lookahead':
      break;

    case 'state':
      {
        const newOut: ASTResult[] = [];
        len += transformCST(result.value, newOut, addText);
        out.push({
          type: 'state',
          value: newOut,
          start: result.pos - len + wslen,
          end: result.pos,
          state: result.state
        });
      }
      break;

    case 'root':
      if (result.trailing_ws) {
        addText(result.trailing_ws);
        len += result.trailing_ws.length;
      }
      transformCST(result.value, out, addText);
      break;

    default:
      const _exhaustive: never = result;
      throw new TypeError('Invalid result!', { cause: { result, out } });
  }

  return len;
}

export abstract class ASTNode {
  constructor(
    public readonly parent: AnyASTNode | null,
    public readonly children: AnyASTNode[],
    public readonly start: number,
    public readonly end: number,
    public readonly _source: string,
    public readonly _offset: number
  ) { }

  get source() {
    return this._source.slice(
      this.start - this._offset,
      this.end - this._offset
    );
  }
}

export class RootNode extends ASTNode {
  constructor(
    parent: AnyASTNode | null, children: AnyASTNode[],
    start: number, end: number, source: string, offset: number
  ) { super(parent, children, start, end, source, offset); }
}

export class StateNode extends ASTNode {
  constructor(
    parent: AnyASTNode | null, children: AnyASTNode[],
    start: number, end: number, source: string, offset: number,
    public readonly state: StateName
  ) { super(parent, children, start, end, source, offset); }
}

export class TerminalNode extends ASTNode {
  constructor(
    parent: AnyASTNode | null, children: AnyASTNode[],
    start: number, end: number, source: string, offset: number,
    public readonly value: MatcherValue
  ) { super(parent, children, start, end, source, offset); }
}

export class IterationNode extends ASTNode {
  constructor(
    parent: AnyASTNode | null, children: AnyASTNode[],
    start: number, end: number, source: string, offset: number,
    public readonly kind: IterationOperator,
    public readonly iterations: AnyASTNode[][]
  ) { super(parent, children, start, end, source, offset); }
}

export type AnyASTNode = RootNode | StateNode | TerminalNode | IterationNode;
export function toTypedAST(value: ASTResult & { type: 'root'; }) {
  if (!value || typeof value !== 'object')
    throw new TypeError(`Invalid value passed to toTypedAST!`, { cause: value });

  if (value.type !== 'root')
    throw new Error(`ASTResult.type: expected 'root', got: ${value.type}`, { cause: value });

  const { start, end, source } = value;
  const rootNode = new RootNode(null, [], start, end, source, start);
  rootNode.children.push(toTypedASTInternal(value.value, rootNode, source, start));
  return rootNode;
}

type OwnerNode = RootNode | StateNode | IterationNode;
function toTypedASTInternal(value: ASTResult, ownerNode: OwnerNode, source: string, offset: number): AnyASTNode {
  if (!value || typeof value !== 'object')
    throw new TypeError(`Invalid value in toTypedAST!`, { cause: value });

  const { start, end } = value;
  switch (value.type) {
    case 'state':
      const val = value.value;
      const children = Array(val.length);
      const stateNode = new StateNode(ownerNode, children, start, end, source, offset, value.state);
      for (let i = 0; i < val.length; i++) {
        children[i] = toTypedASTInternal(val[i], stateNode, source, offset);
      }
      return stateNode;
    case 'terminal':
      return new TerminalNode(ownerNode, [], start, end, source, offset, value.value);
    case 'iteration':
      const iters = value.value;
      const iterations: AnyASTNode[][] = Array(iters.length);
      const iterationNode = new IterationNode(ownerNode, [], start, end, source, offset, value.kind, iterations);
      for (let i = 0; i < iters.length; i++) {
        const iter = iters[i];
        const iteration = iterations[i] = Array(iter.length);
        for (let j = 0; j < iter.length; j++) {
          const transformed = toTypedASTInternal(iter[j], iterationNode, source, offset);
          iteration[j] = transformed;
          iterationNode.children.push(transformed);
        }
      }
      return iterationNode;
    case 'root':
      throw new Error(`Did not expect root node!`, { cause: { value } });
    default:
      const _exhaustive: never = value;
      throw new Error(`Invalid ASTResult.type: ${(value as ASTResult).type}`, { cause: { value } });
  }
}
