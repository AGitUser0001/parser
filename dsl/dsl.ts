import { input_to_graph, type CallToken, type MutableArrayTokenExpr, type MutableArrayTokenSequence, type StandaloneOperator, type State, type StateName, type StateObject, type States, type Token } from "../graph.js";
import { Semantics } from "../semantics.js";

export const grammar = {
  Grammar: ['*', 'State', ['?', /;/]],

  StateObject: [/\{/, [['*', 'State_reg', ['?', /;/]]], /\}/],

  State: {
    reg: ['identifier', /=/, ['?', /\|/], 'Choice_outer'],
    obj: ['identifier', /=/, 'StateObject'],
  },

  Choice: {
    outer: ['Sequence_outer', [['*', /\|/, 'Sequence_outer']]],
    inner: ['Sequence_inner', [['*', /\|/, 'Sequence_inner']]]
  },

  Sequence: {
    outer: ['#', '*', [['!', ['!', /(?<=\n\s*)/], ['%', /(?<=\n\s*)/]]], ['!', '%', /[\]|)}>;,]/], '%Term'],
    inner: '*Term'
  },

  Term: [['Group', 'Reference', 'Terminal', 'Call']],

  Group: ['prefixes', /\(/, 'Choice_inner', /\)/, '#postfixes'],

  Reference: ['prefixes', ['identifier', 'generic'], '#postfixes'],

  Call: ['prefixes', 'identifier', /</, 'Arg', [['*', /,/, 'Arg']], />/, '#postfixes'],
  Arg: ['identifier', /=/, 'Choice_outer'],

  Terminal: ['prefixes', ['terminal', 'string'], '#postfixes'],

  postfixes: '*postfix',
  postfix: /\s*>\s*[A-Za-z0-9_]+(\s*,\s*[A-Za-z0-9_]+)*|[*?+@]/,

  prefixes: '*prefix',
  prefix: /[#%!&$]/,

  identifier: /[A-Za-z_][A-Za-z0-9_]*/,
  generic: /@[A-Za-z_][A-Za-z0-9_]*/,

  terminal: [/\//, /(?:\\.|[^/\\[]|\[(?:\\.|[^\]\\])*\])+/, /\//, /[a-z]*/],

  string: {
    single: [/'/, /[^']+/, /'/],
    double: [/"/, /[^"]+/, /"/]
  }
} as const;

export const graph = input_to_graph<keyof typeof grammar>(grammar);

type Data<K extends StateName> =
  | { t: 'states'; v: States<K>; }
  | { t: 'state_obj'; v: StateObject<K>; }
  | { t: 'state'; v: State<K>; name: K; }
  | { t: 'input'; subType?: undefined; v: Token<K> | StandaloneOperator; }
  | { t: 'input'; subType: 'seq'; v: MutableArrayTokenSequence<K>; }
  | { t: 'input'; subType: 'choice'; v: MutableArrayTokenExpr<K>; }
  | { t: 'arg'; v: MutableArrayTokenSequence<K>; name: string; }
  | { t: 'operators'; v: StandaloneOperator[]; };

function assertType<K extends StateName, T extends Data<K>['t']>(
  data: Data<K>, typeName: T
): asserts data is Data<K> & { t: T; } {
  if (data.t !== typeName)
    throw new TypeError(`Expected ${typeName}, got ${data.t}`, { cause: { data, typeName } });
}

function assertSubType<K extends StateName, T extends (Data<K> & { t: 'input'; })['subType']>(
  data: Data<K> & { t: 'input'; }, subTypeName: T
): asserts data is Data<K> & { t: 'input'; subType: T; } {
  if (data.subType !== subTypeName)
    throw new TypeError(`Expected subType ${subTypeName}, got ${data.subType}`, { cause: { data, subTypeName } });
}

function collapse(v: MutableArrayTokenSequence<StateName>): MutableArrayTokenSequence<StateName> {
  if (v.length === 1 && Array.isArray(v[0]))
    if (v[0].length === 1 && Array.isArray(v[0][0]))
      v = v[0][0];
  return v.map(value => {
    if (Array.isArray(value)) {
      value = collapseExpr(value);
      if (value.length === 1 && !Array.isArray(value[0]))
        return value[0];
    }
    return value;
  });
}
function collapseExpr(v: MutableArrayTokenExpr<StateName>): MutableArrayTokenExpr<StateName> {
  if (v.length === 1 && Array.isArray(v[0]))
    if (v[0].length === 1 && Array.isArray(v[0][0]))
      v = v[0][0];
  return v.map(value => {
    if (Array.isArray(value)) {
      value = collapse(value);
      if (value.length === 1 && !Array.isArray(value[0]))
        return value[0];
    }
    return value;
  });
}

function stringToRegExp(string: string, flags?: string | undefined) {
  return new RegExp(string
    .replace(/[|\\{}()[\]^$+*?.]/g, '\\$&')
    .replace(/-/g, '\\x2d'), flags);
}

export const createSemantics = Semantics.for(graph);
export const semantics = createSemantics<Data<StateName>>('grammar', {
  Grammar(stateIter) {
    const states: States<StateName> = Object.create(null);

    for (const [node, _semicolonIter] of stateIter.iterations) {
      const data = this(node);
      assertType(data, 'state');
      if (states[data.name])
        throw new Error(`Duplicate state: ${data.name}`, { cause: { data, node, states } });
      states[data.name] = data.v;
    }

    return { t: 'states', v: states };
  },

  StateObject(lb, stateIter, rb) {
    const states: StateObject<StateName> = Object.create(null);

    for (const [node, _semicolonIter] of stateIter.iterations) {
      const data = this(node);
      assertType(data, 'state');
      if (!Array.isArray(data.v))
        throw new TypeError('Internal error: subState is not Array', { cause: { data, node } });
      if (states[data.name])
        throw new Error(`Duplicate subState: ${data.name}`, { cause: { data, node, states } });
      states[data.name] = data.v;
    }

    return { t: 'state_obj', v: states };
  },

  State_reg(identifierNode, _eqNode, _barNode, choiceNode) {
    const name = identifierNode.children[0].value as StateName;

    const data = this(choiceNode);
    assertType(data, 'input');
    assertSubType(data, 'choice');

    const seq: MutableArrayTokenSequence<StateName> = [data.v];

    return {
      t: 'state',
      name,
      v: collapse(seq)
    };
  },

  State_obj(identifierNode, _eqNode, statesNode) {
    const name = identifierNode.children[0].value as StateName;

    const data = this(statesNode);
    assertType(data, 'state_obj');

    return {
      t: 'state',
      name,
      v: data.v
    };
  },

  Sequence_inner(terms) {
    const seq: MutableArrayTokenSequence<StateName> = [];

    for (const [termNode] of terms.iterations) {
      const data = this(termNode);
      assertType(data, 'input');
      if (data.subType)
        assertSubType(data, 'choice');
      seq.push(data.v);
    }

    return {
      t: 'input',
      subType: 'seq',
      v: seq
    };
  },
  Sequence_outer(terms) {
    return this.use('Sequence_inner', terms);
  },

  Choice_inner(seqNode, seqIter) {
    const choice: MutableArrayTokenExpr<StateName> = [];
    const data = this(seqNode);
    assertType(data, 'input');
    assertSubType(data, 'seq');
    choice.push(data.v);

    for (const [_union, seqNode] of seqIter.iterations) {
      const data = this(seqNode);
      assertType(data, 'input');
      assertSubType(data, 'seq');
      choice.push(data.v);
    }

    return {
      t: 'input',
      subType: 'choice',
      v: choice
    };
  },
  Choice_outer(seqNode, seqIter) {
    return this.use('Choice_inner', seqNode, seqIter);
  },

  Group(prefixes, lp, choiceNode, rp, postfixes) {
    const prefixA = this(prefixes);
    assertType(prefixA, 'operators');

    const choice = this(choiceNode);
    assertType(choice, 'input');
    assertSubType(choice, 'choice');

    const postfixA = this(postfixes);
    assertType(postfixA, 'operators');

    return {
      t: 'input',
      subType: 'choice',
      v: [...prefixA.v, ...postfixA.v, ...choice.v]
    };
  },

  Reference(prefixes, identifierNode, postfixes) {
    const name = identifierNode.children[0].value as StateName;

    const prefixA = this(prefixes);
    assertType(prefixA, 'operators');

    const postfixA = this(postfixes);
    assertType(postfixA, 'operators');
    return {
      t: 'input',
      subType: 'choice',
      v: [...prefixA.v, ...postfixA.v, name]
    };
  },

  Terminal(prefixes, terminalNode, postfixes) {
    const prefixA = this(prefixes);
    assertType(prefixA, 'operators');

    const terminal = this(terminalNode);
    assertType(terminal, 'input');
    if (!(terminal.v instanceof RegExp))
      throw new TypeError(`Expected RegExp`, { cause: { terminalNode, terminal } });

    const postfixA = this(postfixes);
    assertType(postfixA, 'operators');
    return {
      t: 'input',
      subType: 'choice',
      v: [...prefixA.v, ...postfixA.v, terminal.v]
    };
  },

  terminal(ls, patternNode, rs, flagNode) {
    const pattern = patternNode.value;
    const flags = flagNode.value;
    return {
      t: 'input',
      v: new RegExp(pattern, flags)
    };
  },

  string(node) {
    const [lq, contentNode, rq] = node.children;
    const str = contentNode.value;
    return {
      t: 'input',
      v: stringToRegExp(str)
    };
  },

  postfixes(opIter) {
    const operators: StandaloneOperator[] = [];
    for (const node of opIter.children) {
      const operator = node.children[0].value.trim() as StandaloneOperator;
      operators.push(operator);
    }
    return {
      t: 'operators',
      v: operators
    };
  },
  prefixes(opIter) {
    return this.use('postfixes', opIter);
  },

  Arg(identifierNode, _eqNode, choiceNode) {
    const name = identifierNode.children[0].value;

    const data = this(choiceNode);
    assertType(data, 'input');
    assertSubType(data, 'choice');

    const seq: MutableArrayTokenSequence<StateName> = [data.v];

    return {
      t: 'arg',
      name,
      v: collapse(seq)
    };
  },

  Call(prefixes, idNode, lb, argNode, argIter, rb, postfixes) {
    const name = idNode.children[0].value as StateName;

    const prefixA = this(prefixes);
    assertType(prefixA, 'operators');

    const args: CallToken<StateName>['args'] = Object.create(null);

    const data = this(argNode);
    assertType(data, 'arg');
    args[data.name] = data.v;

    for (const [_sep, argNode] of argIter.iterations) {
      const data = this(argNode);
      assertType(data, 'arg');
      if (args[data.name])
        throw new Error(`Duplicate arg: ${data.name}`, { cause: { data, argNode, args } });
      args[data.name] = data.v;
    }

    const postfixA = this(postfixes);
    assertType(postfixA, 'operators');

    const call: CallToken<StateName> = {
      state: name,
      args
    };

    return {
      t: 'input',
      subType: 'choice',
      v: [...prefixA.v, ...postfixA.v, call]
    };
  }
});

export const WS_REGEX = /\s*(?:\/\/.*$\s*)*/my;
export function compile(input: string) {
  const result = semantics.parse(graph, input, 'Grammar', void 0, WS_REGEX);
  assertType(result, 'states');
  return input_to_graph(result.v);
}
