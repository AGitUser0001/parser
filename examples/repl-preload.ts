import * as graph from '../graph.js';
import * as parser from '../parser.js';
import * as scc from '../scc.js';
import * as ast from '../ast.js';
import * as semantics from '../semantics.js';
import * as tokenize from '../tokenize.js';
import * as dsl from '../dsl/dsl.js';

//#region tests
console.time('transform');
const arithmeticStates = {
  Entry: [[['*', 'Expr', [/\s*,\s*/, ['@', '!Expr']]]], ['?', 'Expr']],
  Expr: ['Add'],

  Add: {
    plus: ['Add', /\+/, 'Mul'],
    minus: ['Add', /-/, 'Mul'],
    base: ['Mul'],
  },

  Mul: {
    times: ['Mul', /\*/, 'Unary'],
    div: ['Mul', /\//, 'Unary'],
    base: ['Unary'],
  },

  Unary: {
    neg: [/-/, 'Unary'],
    base: ['Primary'],
  },

  Primary: {
    group: [/\(/, 'Expr>attr', /\)/],
    num: ['number', ['?', [/e/i, 'number']]],
  },

  number: /[0-9]+/,
} as const;

export const g = graph.input_to_graph<keyof typeof arithmeticStates>(arithmeticStates);
console.timeEnd('transform');

export function run() {
  console.time('run');
  console.time('s1');
  const okCases = [
    '1',
    '12',
    '1+2',
    '1+2*3',
    '1*2+3',
    '1*(2+3)',
    '(1+2)*3',
    '1+2+3+4',
    '2*3*4',
    '2*(3+4*5)',
    '-1',
    '--1',
    '-(1+2)',
    '1+-2',
    '1*-2',
    '-1*-2',
    '10/2/5',
    '10/(2/5)',

    '10 + 2',
    ' 5 * (3+ 4* 5 ) '
  ];

  for (const input of okCases) {
    const r = parser.parse(g, input, 'Entry');
    if (!r.ok || r.pos !== input.length) {
      console.error('❌ FAIL (valid)', input, JSON.stringify(r));
      throw new Error('valid test failed');
    }
  }
  console.timeEnd('s1');
  console.log('✅ deterministic valid cases passed');
  console.time('s2');

  const badCases = [
    // '', // Valid now
    '+',
    '*',
    '1+',
    '1*',
    '(1+2',
    '1+2)',
    '()',
    '(*)',
    '1/**/2',
    '1++2',
    '1**2',
    '--',
    '-',
    '1//2',
  ];

  for (const input of badCases) {
    const r = parser.parse(g, input, 'Entry');
    if (r.ok) {
      console.error('❌ FAIL (invalid)', input, r);
      throw new Error('invalid test failed');
    }
  }
  console.timeEnd('s2');
  console.timeEnd('run');
  console.log('✅ deterministic invalid cases passed');
}

export const s = semantics.Semantics.returns<number>()('attr', g, {
  Entry(expressions, extra) {
    let sum = 0;
    for (const expr of [...expressions.children, ...extra.children]) {
      if (expr instanceof ast.TerminalNode)
        continue;
      sum += this(expr);
    }
    return sum;
  },
  Add_plus(add, plus, mul) {
    return this(add) + this(mul);
  },
  Add_minus(add, minus, mul) {
    return this(add) - this(mul);
  },
  Mul_times(mul, times, unary) {
    return this(mul) * this(unary);
  },
  Mul_div(mul, div, unary) {
    return this(mul) / this(unary);
  },
  Unary_neg(neg, unary) {
    return -this(unary);
  },
  Primary_num(left, opt_e_and_exp) {
    const e = opt_e_and_exp.children[0]?.value;
    if (e)
      return this(left) + (10 ** this(opt_e_and_exp.children[1]));
    return this(left);
  },
  number(num) {
    return +num.value;
  }
});
//#endregion

export function timeof<T extends (...args: any[]) => any>(fn: T, ...args: Parameters<T>): ReturnType<T> {
  console.time(fn.name);
  try {
    return fn(...args);
  } finally {
    console.timeEnd(fn.name);
  }
}

import * as preload from './repl-preload.js';
import { readFileSync } from 'node:fs';
for (const item of [graph, parser, scc, ast, semantics, tokenize, {
  dsl, readFileSync
}, preload] as any[]) {
  for (const key of Object.keys(item)) {
    (globalThis as any)[key] = item[key];
  }
}
