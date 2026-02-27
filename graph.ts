import { computeSCCInfo, type SccId } from './scc.js';
import { customInspectSymbol, freeze, MapView } from './shared.js';
import { type Operators } from './parser.js';

export type IterationOperator = '*' | '+' | '?' | '@';
const iterationOperatorSet: Set<IterationOperator> & { has(k: string): k is IterationOperator; } =
  new Set<IterationOperator>(['*', '?', '+', '@']) as any;
export type Operator = '#' | '%' | '!' | '&' | Exclude<IterationOperator, '@'> | '$' | '/';
const operatorSet: Set<Operator> & { has(k: string): k is Operator; } =
  new Set<Operator>(['#', '%', '!', '&', '*', '?', '+', '$', '/']) as any;

const standaloneOperatorSet: Set<StandaloneOperator> & { has(k: string): boolean; } =
  new Set<StandaloneOperator>([...operatorSet, '@']) as any;

export type OperatorString<K extends StateName> =
  | OperatorPrefixed<K>
  | StandaloneOperator;

type Q = '*' | '?' | '+';
type R1 = '!' | '&';
type R2 = '#' | '%';
type R3 = '$';
type R4 = '/';
type B1 = `${R1 | R3}${R2 | R4}`;
type B2 = `${R2 | R3}${R1 | R4}`;
type B3 = `${R1 | R2}${R3 | R4}`;
type B4 = `${R4}${R1 | R2 | R3}`;

type OperatorPrefixed<K extends StateName> = K extends any ?
  | `${Operator}${V_<K>}`
  | `${Q}${R1 | R2 | R3 | R4}${V_<K>}`
  | `${R1 | R2 | R3 | R4}${Q}${V_<K>}`

  | `${B1 | B2 | B3 | B4}${V_<K>}`

  | `${Q}${B1 | B2 | B3 | B4}${V_<K>}`
  | `${B1 | B2 | B3 | B4}${Q}${V_<K>}`

  | `${R2 | R3}${Q}${R1 | R4}${V_<K>}`
  | `${R1 | R3}${Q}${R2 | R4}${V_<K>}`
  | `${R1 | R2}${Q}${R3 | R4}${V_<K>}`
  | `${R4}${Q}${R1 | R2 | R3}${V_<K>}` : never;

type V_<K extends StateName> = StateKey<K> | Generic;

export type Generic = `@${string}`;
export type StandaloneOperator = Operator | IterationOperator | Generic;

export type StateName = string;
export type StateKey<K extends StateName> = K | `${K}_${StateName}`;

export type TokenString<K extends StateName> = StateKey<K> | OperatorString<K>;
export type Token<K extends StateName> = RegExp | TokenString<K> | CallToken<K>;
export interface CallToken<K extends StateName> {
  state: StateKey<K>;
  args: Record<string, TokenSequence<K>>;
}
function isCallToken<K extends StateName>(tok: InputToken<K>): tok is CallToken<K> {
  return !isPrimitive(tok) && !Array.isArray(tok) && !(tok instanceof RegExp) && 'state' in tok;
}

export type SimpleTokenString<K extends StateName> = StateKey<K>;
export type SimpleToken<K extends StateName> = RegExp | SimpleTokenString<K>;

export type TokenExpr<K extends StateName> = Token<K> | ArrayTokenExpr<K>;
export type ArrayTokenExpr<K extends StateName> = readonly TokenSequence<K>[];
export type TokenSequence<K extends StateName> = Token<K> | ArrayTokenSequence<K>;
export type ArrayTokenSequence<K extends StateName> = readonly TokenExpr<K>[];

export type MutableTokenSequence<K extends StateName> = Token<K> | MutableArrayTokenSequence<K>;
export type MutableArrayTokenSequence<K extends StateName> = MutableTokenExpr<K>[];
export type MutableTokenExpr<K extends StateName> = Token<K> | MutableArrayTokenExpr<K>;
export type MutableArrayTokenExpr<K extends StateName> = MutableTokenSequence<K>[];

export type State<K extends StateName> = Exclude<TokenSequence<K>, CallToken<K>> | StateObject<K>;
export type StateObject<K extends StateName> = Record<StateName, TokenSequence<K>>;
export type States<K extends StateName> = Record<K, State<K>>;

export type MutableState<K extends StateName> = Exclude<MutableTokenSequence<K>, CallToken<K>> | MutableStateObject<K>;
export type MutableStateObject<K extends StateName> = Record<StateName, MutableTokenSequence<K>>;
export type MutableStates<K extends StateName> = Record<K, MutableState<K>>;

export class Choice<K extends StateName> extends Array<SimpleToken<K> | Sequence<K> | StandaloneOperator>
  implements GraphCollection<K> {
  get [Symbol.toStringTag](): 'Choice' {
    return 'Choice';
  }
  #arity: number | null = null;
  get arity() {
    const v = this.#arity;
    if (v !== null) return v;
    return this.#arity = calculateArity_Choice(this);
  }
  #operators: Operators<K> | null = null;
  get operators(): Operators<K> {
    const v = this.#operators;
    if (v) return v;
    return this.#operators = getOperators(this);
  }
  #generic: boolean | null = null;
  get generic() {
    if (this.#generic !== null)
      return this.#generic;
    return this.#generic = findGeneric(this);
  }
}
export class Sequence<K extends StateName> extends Array<SimpleToken<K> | Choice<K> | StandaloneOperator>
  implements GraphCollection<K> {
  get [Symbol.toStringTag](): 'Sequence' {
    return 'Sequence';
  }
  #arity: number | null = null;
  get arity() {
    const v = this.#arity;
    if (v !== null) return v;
    return this.#arity = calculateArity_Sequence(this);
  }
  #operators: Operators<K> | null = null;
  get operators(): Operators<K> {
    const v = this.#operators;
    if (v) return v;
    return this.#operators = getOperators(this);
  }
  #generic: boolean | null = null;
  get generic() {
    if (this.#generic !== null)
      return this.#generic;
    return this.#generic = findGeneric(this);
  }
}

function findGeneric<K extends StateName>(node: Sequence<K> | Choice<K>) {
  for (const item of node) {
    if (isGeneric(item))
      return true;
    if (item instanceof Sequence || item instanceof Choice)
      if (item.generic)
        return true;
  }
  return false;
}

export interface TokenCollection<K extends StateName> extends ReadonlyArray<InputToken<K>> { }
export interface GraphCollection<K extends StateName> extends Array<GraphToken<K>> {
  arity: number;
  operators: Operators<K>;
  generic: boolean;
}
type GraphMap<K extends StateName> = Map<StateKey<K>, Sequence<K>>;

export class Graph<K extends StateName> extends MapView<StateKey<K>, Sequence<K>> {
  get [Symbol.toStringTag]() {
    return 'Graph';
  }
  #sccOf: MapView<StateKey<K>, SccId>;
  #sccMembers: MapView<SccId, StateKey<K>[]>;
  get sccOf() { return this.#sccOf; }
  get sccMembers() { return this.#sccMembers; }

  constructor(map: GraphMap<K>) {
    super(map);
    finalizeGraph(this);
    const sccInfo = computeSCCInfo(this);
    this.#sccOf = new MapView(sccInfo.sccOf);
    this.#sccMembers = new MapView(sccInfo.sccMembers);
    for (const [key, entry] of sccInfo.sccMembers)
      freeze(entry);
  }
  get(key: K): Sequence<K>;
  get(key: StateKey<K>): Sequence<K> | undefined;
  get(key: StateKey<K>): Sequence<K> | undefined {
    return super.get(key);
  }
  has(key: K): true;
  has(key: StateKey<K>): boolean;
  has(key: StateKey<K>): boolean {
    return super.has(key);
  }
  [customInspectSymbol]() {
    class Graph extends Map<StateKey<K>, Sequence<K>> {
      get [Symbol.toStringTag]() {
        return 'Graph';
      }
    };
    return new Graph(this);
  }
};

export function input_to_graph<K extends StateName>(input: States<K>) {
  const states: States<K> = input as States<any>;
  const graphMap: GraphMap<K> = new Map();
  const stateLabels = Object.keys(input) as K[];
  function convertSequence(inputSeq: TokenSequence<K>): Sequence<K> {
    const sequence = new Sequence<K>();
    if (isPrimitive(inputSeq) || inputSeq instanceof RegExp) {
      sequence.push(convertPrimitive<Choice<K>>(inputSeq, Choice));
      return sequence;
    } else if (isCallToken(inputSeq)) {
      sequence.push(convertCallToken(inputSeq));
      return sequence;
    }
    for (const item of inputSeq) {
      if (isPrimitive(item) || item instanceof RegExp) {
        sequence.push(convertPrimitive<Choice<K>>(item, Choice));
      } else if (isCallToken(item)) {
        sequence.push(convertCallToken(item));
      } else {
        sequence.push(convertExpr(item));
      }
    }
    return sequence;
  }
  function convertExpr(inputExpr: TokenExpr<K>): Choice<K> {
    const choice = new Choice<K>();
    if (isPrimitive(inputExpr) || inputExpr instanceof RegExp) {
      choice.push(convertPrimitive<Sequence<K>>(inputExpr, Sequence));
      if (choice[0] instanceof Choice)
        return choice[0];
      return choice;
    } else if (isCallToken(inputExpr)) {
      choice.push(convertCallToken(inputExpr));
      return choice;
    }
    for (const item of inputExpr) {
      if (isPrimitive(item) || item instanceof RegExp) {
        choice.push(convertPrimitive<Sequence<K>>(item, Sequence));
      } else if (isCallToken(item)) {
        choice.push(convertCallToken(item));
      } else {
        choice.push(convertSequence(item));
      }
    }
    return choice;
  }

  type GenericStateKey = `${StateKey<K>}@${number}`;
  const toCompile = new Map<GenericStateKey, {
    state: StateKey<K>;
    args: Map<string, Sequence<K>>;
  }>();
  function convertCallToken(inputCallToken: CallToken<K>): StateKey<K> {
    const state = inputCallToken.state;
    if (typeof state !== 'string')
      throw new TypeError(`Expected string, got: ${typeof state}`, { cause: inputCallToken });
    let x = 0;
    while (toCompile.has(`${state}@${x}`))
      x++;

    const key: GenericStateKey = `${state}@${x}`;
    toCompile.set(key, {
      state,
      args: new Map(
        Object.entries(inputCallToken.args)
          .map(([key, seq]) => [key, convertSequence(seq)])
      )
    });
    return key as StateKey<K>;
  }

  function convertPrimitive<T extends GraphCollection<K>>(
    tok: Token<K> | StandaloneOperator, nestedCollectionConstructor: new () => T
  ): RegExp | T | StateKey<K> | StandaloneOperator {
    if (tok instanceof RegExp) {
      const newFlags = tok.flags.replace('g', '') + (tok.sticky ? '' : 'y');
      return new RegExp(tok.source, newFlags);
    }
    if (typeof tok !== 'string')
      throw new TypeError(`Expected string, got: ${typeof tok}`, { cause: tok });

    if (isOperator(tok)) return tok;

    const output = new nestedCollectionConstructor();
    loop: while (true) {
      for (const op of operatorSet)
        if (tok.startsWith(op)) {
          tok = tok.slice(op.length) as SimpleTokenString<K> | StandaloneOperator;
          output.push(op);
          continue loop;
        }
      break;
    }
    if (output.length) {
      output.push(tok as SimpleTokenString<K>);
      return output;
    }
    return tok as StateKey<K>;
  }

  function add(key: StateKey<K>, value: Sequence<K>) {
    if (graphMap.has(key))
      throw new Error(`Conflicting state key: ${key}`, { cause: { key, graphMap } });
    graphMap.set(key, value);
  }
  for (const stateLabel of stateLabels) {
    const state: State<K> = states[stateLabel];
    if (isPrimitive(state) || state instanceof RegExp || state instanceof Array) {
      add(stateLabel, convertSequence(state));
    } else {
      const subLabels: StateName[] = Object.keys(state) as StateName[];
      const sequence = new Sequence<K>();
      const choice = new Choice<K>();
      sequence.push(choice);
      for (const subLabel of subLabels) {
        if (subLabel === '_') {
          const data = state[subLabel];
          if (!Array.isArray(data) || data.length !== 1 || !Array.isArray(data[0]))
            throw new Error(`Special subLabel _ must be structured [[...]]`, {
              cause: { states, stateLabel, subLabel, graphMap }
            });
          const extra: ArrayTokenExpr<K> = data[0];
          choice.push(...convertExpr(extra));
          continue;
        }
        const label = `${stateLabel}_${subLabel}` as const;
        add(label, convertSequence(state[subLabel]));
        choice.push(label);
      }
      add(stateLabel, sequence);
    }
  }

  for (const [key, call] of toCompile) {
    const newState = key as StateKey<K>;
    const origState = graphMap.get(call.state);
    if (!origState)
      throw new Error(`State does not exist: ${call.state}`, { cause: { call, graphMap } });

    const input: MutableTokenSequence<K> = structuredClone(origState);
    function processArray(arr: MutableTokenSequence<K> | MutableTokenExpr<K>, depth: number) {
      if (!Array.isArray(arr))
        throw new TypeError('processArray should only encounter arrays!', { cause: { arr, depth } });
      for (let i = 0; i < arr.length; i++) {
        const item = arr[i];
        if (isGeneric(item)) {
          const name = parseGeneric(item);
          if (!call.args.has(name))
            throw new Error(`Missing generic argument in call: ${name}`, { cause: { item, input } });
          const data = structuredClone(call.args.get(name)!);
          arr[i] = ['@', depth % 2 === 0 ? data : [data]];
        } else if (Array.isArray(item)) {
          processArray(item, depth + 1);
        }
      }
    }
    processArray(input, 0);
    add(newState, convertSequence(input));
  }

  return new Graph(graphMap);
}

function isPrimitive(data: any): data is string | boolean | number | symbol | bigint | undefined | null {
  if (data === null) return true;
  return typeof data !== 'object' && typeof data !== 'function';
}

export type AnyToken<K extends StateName> = InputToken<K> | GraphToken<K>;
export type InputToken<K extends StateName> = Token<K> | StandaloneOperator | TokenSequence<K> | TokenExpr<K>;
export type GraphToken<K extends StateName> = SimpleToken<K> | StandaloneOperator | Sequence<K> | Choice<K>;
export function isOperator(
  tok: AnyToken<StateName>
): tok is StandaloneOperator {
  if (isPrimitive(tok)) {
    if (typeof tok !== 'string')
      throw new TypeError(`Expected string, got: ${typeof tok}`, { cause: tok });
    if (standaloneOperatorSet.has(tok))
      return true;
    if (isGeneric(tok))
      return true;
  }
  return false;
}

export function isGeneric(
  tok: AnyToken<StateName>
): tok is Generic {
  if (isPrimitive(tok)) {
    if (typeof tok !== 'string')
      throw new TypeError(`Expected string, got: ${typeof tok}`, { cause: tok });
    if (tok.startsWith('@') && tok !== '@')
      return true;
  }
  return false;
}

export function parseGeneric(generic: Generic): string {
  if (!isGeneric(generic))
    throw new Error(`Not a generic reference!`, { cause: generic });
  return generic.slice(1).trim();
}

function finalizeGraph<K extends StateName>(
  graph: Graph<K>
): void {
  for (const seq of graph.values()) {
    finalizeNode(seq, graph);
  }
}

function finalizeNode<K extends StateName>(
  node: GraphToken<K>,
  graph: Graph<K>,
  insideIteration = false
): void {
  if (isOperator(node))
    return;

  if (node instanceof Sequence || node instanceof Choice) {
    node.arity;
    const operators = new Set<StandaloneOperator>();

    for (const item of node) {
      if (isOperator(item)) {
        if (isGeneric(item)) {
          // skip
        } else {
          operators.add(item);
        }
      }
    }

    const plookahead = operators.has('&');
    const nlookahead = operators.has('!');
    if (plookahead && nlookahead)
      throw new Error(
        `Cannot have both positive and negative lookahead`,
        { cause: { node, graph } }
      );
    const repetition0 = operators.has('*');
    const repetition1 = operators.has('+');
    const optional = operators.has('?');

    if (
      (repetition0 && repetition1) ||
      (repetition1 && optional) ||
      (repetition0 && optional)
    )
      throw new Error(
        `Cannot have multiple types of repetition`,
        { cause: { node, graph } }
      );

    const at = operators.has('@');
    const orderedChoice = operators.has('/');
    if (orderedChoice && !(node instanceof Choice))
      throw new Error(
        `Ordered choice operator '/' can only be applied to Choice`,
        { cause: { node, graph } }
      );

    const rewind = operators.has('$');
    const lookahead = plookahead || nlookahead;
    const repetition = repetition0 || repetition1 || optional;
    if (at && repetition)
      throw new Error(
        `Cannot have @ operator and repetition`,
        { cause: { node, graph } }
      );

    const iteration = at || repetition;
    const lex = operators.has('#');
    const syn = operators.has('%');
    if (lex && syn)
      throw new Error(
        `Cannot have both lexical and syntactic operator`,
        { cause: { node, graph } }
      );

    for (const item of node) {
      finalizeNode(item, graph, insideIteration || iteration);
    }
    freeze(node);
    return;
  }

  // Terminal node
  if (node instanceof RegExp) {
    if (!node.sticky || node.global)
      throw new Error(`finalizeNode: Expected sticky and non-global regex, got: ${node.flags}`, { cause: node });
    return;
  }

  if (typeof node !== 'string')
    throw new Error(`Invalid node datatype`, { cause: node });

  if (!graph.has(node))
    throw new Error(
      `Invalid state ${node}`,
      { cause: { node, graph } }
    );

  if (graph.get(node)!.generic)
    throw new Error(
      `Cannot reference state containing generics without call: ${node}`,
      { cause: { node, graph } }
    );
}

function calculateArity_Sequence(
  seq: Sequence<StateName>
): number {
  let seqArity = 0;

  for (const item of seq) {
    if (isOperator(item)) {
      if (item === '&' || item === '!') {
        return 0;
      }
      if (iterationOperatorSet.has(item)) {
        return 1;
      }
      if (!isGeneric(item))
        continue;
    }

    if (item instanceof Choice || item instanceof Sequence) {
      seqArity += item.arity;
      continue;
    }

    // Token (RegExp or StateKey or Call)
    seqArity += 1;
  }

  return seqArity;
}

function calculateArity_Choice(
  oc: Choice<StateName>
): number {
  let expected: number | undefined, expectedBranch: GraphToken<StateName> | undefined;

  for (const branch of oc) {
    let branchArity: number;

    if (isOperator(branch)) {
      if (branch === '&' || branch === '!') {
        return 0;
      }
      if (iterationOperatorSet.has(branch)) {
        return 1;
      }
      if (isGeneric(branch))
        branchArity = 1;
      else
        continue;
    } else if (branch instanceof Sequence || branch instanceof Choice) {
      branchArity = branch.arity;
    } else {
      // Token (RegExp or StateKey or Call)
      branchArity = 1;
    }

    if (expected === undefined) {
      expected = branchArity;
      expectedBranch = branch;
    } else if (expected !== branchArity) {
      throw new Error(
        `Choice has conflicting arities: ${expected} vs ${branchArity}`,
        { cause: [expectedBranch, branch] }
      );
    }
  }

  return expected ?? 0;
}

export const OP_MAP: Record<StandaloneOperator, number> = Object.create(null);
{
  let bit = 1;
  for (const op of standaloneOperatorSet) {
    OP_MAP[op] = bit;
    bit <<= 1;
  }
  freeze(OP_MAP);
}

function getBitmask(ops: ReadonlySet<StandaloneOperator>) {
  let mask = 0;
  for (const op of ops) {
    mask |= (OP_MAP[op]);
  }
  return mask;
}

function getOperators<K extends StateName>(xs: GraphCollection<K>): Operators<K> {
  const ops = new Set<StandaloneOperator>();
  const body: (Exclude<GraphToken<K>, StandaloneOperator> | Generic)[] = [];

  for (const x of xs) {
    if (isOperator(x)) {
      if (isGeneric(x))
        body.push(x);
      else
        ops.add(x);
    } else {
      body.push(x as Exclude<GraphToken<K>, StandaloneOperator>);
    }
  }

  return freeze([
    getBitmask(ops),
    freeze(body)
  ]);
}

export function graph_to_input<K extends StateName>(graph: Graph<K>): States<StateKey<K>> {
  const states: Partial<States<StateKey<K>>> = {};
  for (const [key, sequence] of graph) {
    Object.defineProperty(states, key, {
      value: structuredClone(sequence),
      writable: true,
      configurable: true,
      enumerable: true
    });
  }
  return states as States<StateKey<K>>;
}
