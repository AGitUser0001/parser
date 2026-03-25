import type { CallToken, MutableArrayTokenExpr, MutableArrayTokenSequence, MutableStateObject, StandaloneOperator, StateName, Token, MutableState, MutableStates } from "../graph.js";
import { input_to_graph, typed_states, toParseTree, build, Semantics, Graph } from "../index.js";

export const grammar = typed_states({
  Grammar: ['*', 'State', ['?', /;/]],

  StateObject: ['prefixes', /\{/, [['*', 'State_reg', ['?', /;/]]], /\}/, '#postfixes'],

  State: {
    reg: ['identifier', /=/, [['!', 'prefixes', /\{/]], 'Choice_outer'],
    obj: ['identifier', /=/, 'StateObject']
  },

  Choice: {
    outer: [['?', /\|/], 'Sequence_outer', [['*', /\|/, 'Sequence_outer']]],
    inner: [['?', /\|/], 'Sequence_inner', [['*', /\|/, 'Sequence_inner']]]
  },

  Sequence: {
    outer: ['#', '*', ['!', /\s*\n/, ['%', /$/]], [['!', ['!', /(?<=\n\s*)/], ['%', /(?<=\n\s*)/]]], ['!', '%', /[\]|)}>;,]/], '%Term'],
    inner: '*Term'
  },

  // Must be Group first, Call before Reference
  Term: ['prefixes', ['/', 'Group', 'Terminal', 'Call', 'Reference'], '#postfixes'],

  Group: [/\(/, 'Choice_inner', /\)/],

  Reference: [['identifier', 'generic']],

  Call: ['identifier', /</, 'Arg', [['*', /,/, 'Arg']], />/],
  Arg: ['identifier', /=/, 'Choice_outer'],

  Terminal: [['terminal', 'string']],

  postfixes: '*postfix',
  postfix: /[*?+@/]/,

  prefixes: '*prefix',
  prefix: /[#%!&$]/,

  identifier: /[$_\p{ID_Start}](?:[$_\u200C\u200D\p{ID_Continue}])*/u,
  generic: [/@/, 'identifier'],

  terminal: [/\//, /(?:\\.|[^/\\[\r\n]|\[(?:\\.|[^\]\\\r\n])*\])+/, /\//, /[a-z]*/],

  string: {
    single: [/'/, /[^']+/, /'/, /[a-z]*/],
    double: [/"/, /[^"]+/, /"/, /[a-z]*/]
  }
});

export const graph = input_to_graph(grammar);

type Data<K extends StateName> =
  | { t: 'states'; v: MutableStates<K>; }
  | { t: 'state_obj'; v: MutableStateObject<K>; }
  | { t: 'state'; v: MutableState<K>; name: K; }
  | { t: 'input'; subType?: undefined; v: Token<K> | StandaloneOperator; }
  | { t: 'input'; subType: 'seq'; v: MutableArrayTokenSequence<K>; }
  | { t: 'input'; subType: 'choice'; v: MutableArrayTokenExpr<K>; }
  | { t: 'arg'; v: MutableArrayTokenSequence<K>; name: string; }
  | { t: 'operators'; v: StandaloneOperator[]; }
  | { t: 'string'; v: string; };

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

function str<K extends StateName>(data: Data<K>): string {
  assertType(data, 'string');
  return data.v;
}

function collapse(v: MutableArrayTokenSequence<StateName>): MutableArrayTokenSequence<StateName> {
  while (
    (v.length === 1 && Array.isArray(v[0])) &&
    (v[0].length === 1 && Array.isArray(v[0][0]))
  ) v = v[0][0];
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
  while (
    (v.length === 1 && Array.isArray(v[0])) &&
    (v[0].length === 1 && Array.isArray(v[0][0]))
  ) v = v[0][0];
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
export const semantics = createSemantics<Data<StateName>>({
  Grammar(stateIter) {
    const states: MutableStates<StateName> = Object.create(null);

    for (const [node, _semicolonIter] of stateIter.iterations) {
      const data = this(node);
      assertType(data, 'state');
      if (states[data.name])
        throw new Error(`Duplicate state: ${data.name}`, { cause: { data, node, states } });
      states[data.name] = data.v;
    }

    return { t: 'states', v: states };
  },

  StateObject(prefixes, lp, stateIter, rp, postfixes) {
    const prefixA = this(prefixes);
    assertType(prefixA, 'operators');

    const postfixA = this(postfixes);
    assertType(postfixA, 'operators');

    const states: MutableStateObject<StateName> = Object.create(null);

    for (const [node, _semicolonIter] of stateIter.iterations) {
      const data = this(node);
      assertType(data, 'state');
      if (!Array.isArray(data.v))
        throw new TypeError('Internal error: subState is not Array', { cause: { data, node } });
      if (states[data.name])
        throw new Error(`Duplicate subState: ${data.name}`, { cause: { data, node, states } });
      states[data.name] = data.v;
    }

    const operators = [...prefixA.v, ...postfixA.v];
    if (states['_'])
      states['_'] = [collapseExpr([states['_']])];
    if (operators.length) {
      if (!states['_'])
        states['_'] = [[]];
      const arr = states['_'][0];
      if (!Array.isArray(arr))
        throw new TypeError(`Internal error: states['_'][0] is not Array?`, { cause: { states, arr } });
      arr.push(...operators);
    }

    return { t: 'state_obj', v: states };
  },

  State_reg(identifierNode, _eqNode, choiceNode) {
    const name = str(this(identifierNode)) as StateName;

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
    const name = str(this(identifierNode)) as StateName;

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

  Choice_inner(_pipeNode, seqNode, seqIter) {
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
  Choice_outer(_pipeNode, seqNode, seqIter) {
    return this.use('Choice_inner', _pipeNode, seqNode, seqIter);
  },

  Term(prefixes, node, postfixes) {
    const term = this(node);
    assertType(term, 'input');
    assertSubType(term, 'choice');

    const prefixA = this(prefixes);
    assertType(prefixA, 'operators');

    const postfixA = this(postfixes);
    assertType(postfixA, 'operators');

    const operators = [...prefixA.v, ...postfixA.v];
    if (term.v.length === 1 && Array.isArray(term.v[0])) {
      if (!operators.includes('/'))
        return {
          t: 'input',
          subType: 'choice',
          v: [[...operators, ...term.v[0]]]
        };
    }

    return {
      t: 'input',
      subType: 'choice',
      v: [...operators, ...term.v]
    }
  },

  Group(lp, choiceNode, rp) {
    const choice = this(choiceNode);
    assertType(choice, 'input');
    assertSubType(choice, 'choice');

    return choice;
  },

  Reference(identifierNode) {
    const name = str(this(identifierNode)) as StateName;

    return {
      t: 'input',
      subType: 'choice',
      v: [name]
    };
  },

  Terminal(terminalNode) {
    const terminal = this(terminalNode);
    assertType(terminal, 'input');
    if (!(terminal.v instanceof RegExp))
      throw new TypeError(`Expected RegExp`, { cause: { terminalNode, terminal } });

    return {
      t: 'input',
      subType: 'choice',
      v: [terminal.v]
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
    const [lq, contentNode, rq, flagNode] = node.children;
    const flags = flagNode.value;
    return {
      t: 'input',
      v: stringToRegExp(contentNode.value, flags)
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
    const name = str(this(identifierNode));

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

  Call(idNode, lb, argNode, argIter, rb) {
    const name = str(this(idNode)) as StateName;

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

    const call: CallToken<StateName> = {
      state: name,
      args
    };

    return {
      t: 'input',
      subType: 'choice',
      v: [call]
    };
  },

  identifier(t) {
    return {
      t: 'string',
      v: t.value
    };
  },

  generic(t, id) {
    const label = str(this(id));

    return {
      t: 'string',
      v: t.value + label
    };
  }
});

export const parse = build(graph);

export const WS_REGEX = /(?:\s+|\/\/.*$|\/\*[\s\S]*?\*\/)+/my;
export function load<K extends StateName>(input: string): MutableStates<K> {
  const parsed = parse(input, 'Grammar', WS_REGEX);
  const parseTree = toParseTree(parsed, graph);
  const result = semantics.evaluate(parseTree);
  assertType(result, 'states');
  return result.v as MutableStates<K>;
}

export function compile<K extends StateName>(input: string): Graph<K> {
  return input_to_graph(load<K>(input));
}
