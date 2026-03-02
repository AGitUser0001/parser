import type { StateName, IterationOperator } from './graph.js';
import type { Result, MatcherValue } from './parser.js';

export function toParseTree(result: Result): RootNode {
  if (!result.ok)
    throw new Error(`toParseTree: Got failing result`, { cause: result });
  const out: ParseTreeNode[] = [];
  const text: string[] = [];
  const len = transformCST(result, out, str => text.push(str));

  const sourceText = text.join('');
  const start = result.pos - len;
  const end = result.pos;
  const rootNode = new RootNode(out, start, end, sourceText);
  return rootNode;
}

function transformCST(result: Result, out: ParseTreeNode[], addText: (str: string) => void): number {
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
      out.push(new TerminalNode([], result.pos - len + wslen, result.pos, result.value));
      break;

    case 'sequence':
      for (let i = 0; i < result.value.length; i++) {
        len += transformCST(result.value[i], out, addText);
      }
      break;

    case 'choice':
    case 'rewind':
      transformCST(result.value, out, addText);
      break;

    case 'iteration':
      {
        const v = result.value;
        const iterations: ParseTreeNode[][] = Array(v.length);
        const children: ParseTreeNode[] = [];
        for (let i = 0; i < v.length; i++) {
          const startIndex = children.length;
          len += transformCST(v[i], children, addText);
          const iter = children.slice(startIndex);
          iterations[i] = iter;
        }
        out.push(new IterationNode(children, result.pos - len + wslen, result.pos, result.kind, iterations));
      }
      break;

    case 'lookahead':
      break;

    case 'state':
      {
        const newOut: ParseTreeNode[] = [];
        len += transformCST(result.value, newOut, addText);
        out.push(new StateNode(newOut, result.pos - len + wslen, result.pos, result.state));
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

abstract class ParseNode {
  parent: ParseTreeNode | null = null;
  constructor(
    public children: ParseTreeNode[],
    public start: number,
    public end: number
  ) { }

  _source: string | null = null;
  get source(): string {
    if (this._source) return this._source;
    let node: ParseNode = this;
    while (node.parent) node = node.parent;
    return this._source = node.source.slice(
      this.start - node.start,
      this.end - node.start
    );
  }
}

export class RootNode extends ParseNode {
  _source: string;
  constructor(
    children: ParseTreeNode[],
    start: number, end: number, source: string,
  ) {
    super(children, start, end);
    this._source = source;
    for (const child of children)
      child.parent = this;
  }

  get source() {
    return this._source;
  }
}

export class StateNode extends ParseNode {
  constructor(
    children: ParseTreeNode[],
    start: number, end: number,
    public readonly state: StateName
  ) {
    super(children, start, end);
    for (const child of children)
      child.parent = this;
  }
}

export class TerminalNode extends ParseNode {
  constructor(
    children: ParseTreeNode[],
    start: number, end: number,
    public readonly value: MatcherValue
  ) {
    super(children, start, end);
    for (const child of children)
      child.parent = this;
  }
}

export class IterationNode extends ParseNode {
  constructor(
    children: ParseTreeNode[],
    start: number, end: number,
    public readonly kind: IterationOperator,
    public readonly iterations: ParseTreeNode[][]
  ) {
    super(children, start, end);
    for (const child of children)
      child.parent = this;
  }
}

export type ParseTreeNode = RootNode | StateNode | TerminalNode | IterationNode;
