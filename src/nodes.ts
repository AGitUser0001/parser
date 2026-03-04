import type { StateName, IterationOperator } from './graph.js';
import type { Result, MatcherValue } from './parser.js';
import type { DeepReplace, Display } from './shared.js';

export function toParseTree(result: Result): RootNode {
  if (!result.ok)
    throw new Error(`toParseTree: Got failing result`, { cause: result });
  const out: ParseTreeNode[] = [];
  const text: string[] = [];
  const len = transformCST(result, out, text);

  const sourceText = text.join('');
  const start = result.pos - len;
  const end = result.pos;
  const rootNode = new RootNode(out, start, end, sourceText);
  return rootNode;
}

function transformCST(result: Result, out: ParseTreeNode[], text: string[]): number {
  if (!result.ok) return 0;
  let len = 0, wslen = 0;
  if (result.ws) {
    text.push(result.ws);
    len += result.ws.length;
    wslen = result.ws.length;
  }
  switch (result.type) {
    case 'terminal':
      text.push(result.value);
      len += result.value.length;
      out.push(new TerminalNode([], result.pos - len + wslen, result.pos, result.value));
      break;

    case 'sequence':
      for (let i = 0; i < result.value.length; i++) {
        len += transformCST(result.value[i], out, text);
      }
      break;

    case 'choice':
    case 'rewind':
      transformCST(result.value, out, text);
      break;

    case 'iteration':
      {
        const v = result.value;
        const iterations: ParseTreeNode[][] = Array(v.length);
        const children: ParseTreeNode[] = [];
        for (let i = 0; i < v.length; i++) {
          const startIndex = children.length;
          len += transformCST(v[i], children, text);
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
        len += transformCST(result.value, newOut, text);
        out.push(new StateNode(newOut, result.pos - len + wslen, result.pos, result.state));
      }
      break;

    case 'root':
      if (result.trailing_ws) {
        text.push(result.trailing_ws);
        len += result.trailing_ws.length;
      }
      transformCST(result.value, out, text);
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

  toJSON(): IncompleteRepresentation & { type: 'root' } {
    return {
      type: 'root',
      children: this.children,
      start: this.start,
      end: this.end,
      source: this.source
    };
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

  toJSON(): IncompleteRepresentation & { type: 'state' } {
    return {
      type: 'state',
      children: this.children,
      start: this.start,
      end: this.end,
      state: this.state
    };
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

  toJSON(): IncompleteRepresentation & { type: 'terminal' } {
    return {
      type: 'terminal',
      children: this.children,
      start: this.start,
      end: this.end,
      value: this.value
    };
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

  toJSON(): IncompleteRepresentation & { type: 'iteration' } {
    return {
      type: 'iteration',
      start: this.start,
      end: this.end,
      kind: this.kind,
      iterations: this.iterations
    };
  }
}

type BaseRepresentation = {
  type: string;
  start: number;
  end: number;
}

export type RootRepresentation = BaseRepresentation & {
  type: 'root';
  children: Representation[];
  source: string;
};


export type StateRepresentation = BaseRepresentation & {
  type: 'state';
  children: Representation[];
  state: StateName;
};

export type TerminalRepresentation = BaseRepresentation & {
  type: 'terminal';
  children: Representation[];
  value: string;
};

export type IterationRepresentation = BaseRepresentation & {
  type: 'iteration';
  kind: IterationOperator;
  iterations: Representation[][];
};

export type Representation = RootRepresentation | StateRepresentation | TerminalRepresentation | IterationRepresentation;
export type IncompleteRepresentation = Display<
  DeepReplace<Representation, [Representation[], ParseTreeNode[]] | [Representation[][], ParseTreeNode[][]]>
>;

export function toJSON(value: ParseTreeNode): Representation {
  const v = value.toJSON();
  switch (v.type) {
    case 'root':
      const r = v as unknown as RootRepresentation;
      r.children = v.children.map(toJSON);
      return r;
    case 'state':
      const s = v as unknown as StateRepresentation;
      s.children = v.children.map(toJSON);
      return s;
    case 'terminal':
      const t = v as unknown as TerminalRepresentation;
      t.children = v.children.map(toJSON);
      return t;
    case 'iteration':
      const i = v as unknown as IterationRepresentation;
      i.iterations = v.iterations.map(
        a => a.map(toJSON)
      );
      return i;
    default:
      throw new TypeError(`Invalid Representation.type: ${(v as any).type}`, { cause: v });
  }
}

export function fromJSON(value: Representation): ParseTreeNode {
  const v = value;
  switch (v.type) {
    case 'root':
      return new RootNode(v.children.map(fromJSON), v.start, v.end, v.source);
    case 'state':
      return new StateNode(v.children.map(fromJSON), v.start, v.end, v.state);
    case 'terminal':
      return new TerminalNode(v.children.map(fromJSON), v.start, v.end, v.value);
    case 'iteration':
      const i = v.iterations.map(
        a => a.map(fromJSON)
      );
      return new IterationNode(i.flat(), v.start, v.end, v.kind, i);
    default:
      throw new TypeError(`Invalid Representation.type: ${(v as any).type}`, { cause: v });
  }
}

export type ParseTreeNode = RootNode | StateNode | TerminalNode | IterationNode;
