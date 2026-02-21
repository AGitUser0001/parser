import * as graph from '../graph.js';
import * as parser from '../parser.js';
import * as ast from '../ast.js';
import * as semantics from '../semantics.js';

const jsonStates = {
  Entry: [
    'Value>json'
  ],
  Value: {
    obj: 'Object',
    arr: 'Array',
    str: 'string',
    num: 'number',
    bool: 'boolean',
    null: /null/,
  },
  Object: [
    /\{/,
    {
      state: 'Items', args: {
        'Sep': /,/,
        'Value': ['string', /:/, 'Value']
      }
    },
    /\}/
  ],
  Array: [
    /\[/,
    {
      state: 'Items', args: {
        'Sep': /,/,
        'Value': 'Value'
      }
    },
    /\]/
  ],
  string: [/"/, ['*', 'stringBody'], /"/],
  stringBody: /([^"\\]|\\(["\\/bfnrt]|u[0-9a-fA-F]{4}))+/,

  number: /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/,
  boolean: /true|false/,
  Items: ['?', '@Value', [['*', '@Sep', '@Value']]],
} as const;
const jsonGraph = graph.input_to_graph<keyof typeof jsonStates>(jsonStates);

import util from 'node:util';
import { readFile } from 'node:fs/promises';
console.log(util.inspect(jsonGraph, {
  depth: 10
}));
console.log(util.inspect(graph.graph_to_input(jsonGraph), {
  depth: 10
}));

const jsonSemantics = new semantics.Semantics('json', jsonGraph, {
  Items(items_con) {
    if (!items_con.children.length)
      return [];
    const [firstValue, restIter] = items_con.children;
    return [
      firstValue.children,
      ...restIter.iterations
        .map(([sep, value]) => value.children)
    ];
  },

  Object(_s1, items, _s2) {
    const pairs = this(items);

    const obj: any = {};
    for (const [key, _colon, value] of pairs) {
      obj[this(key)] = this(value);
    }
    return obj;
  },

  Array(_s1, items, _s2) {
    return this(items).flat().map(this);
  },

  string(q1, iter, q2) {
    return iter.children.map(this).join('');
  },

  stringBody(t) {
    if (!t.value.startsWith('\\'))
      return t.value;
    switch (t.value) {
      case '\\b': return '\b';
      case '\\f': return '\f';
      case '\\n': return '\n';
      case '\\r': return '\r';
      case '\\t': return '\t';
      default:
        if (t.value.startsWith('\\u'))
          return String.fromCharCode(parseInt(t.value.slice(2), 16));
        return t.value[1];
    }
  },

  number(node) {
    return parseFloat(node.value);
  },

  boolean(node) {
    return node.value === 'true';
  },

  Value_null(_null) {
    return null;
  }
});

// const input = await (await fetch('https://microsoftedge.github.io/Demos/json-dummy-data/5MB.json')).text();
const input = await readFile('./json_sample1k.json', 'utf-8');

console.time('Native');
try {
  JSON.parse(input);
} catch (e) {
  console.log(e);
}
console.timeEnd('Native');

import Benchmark from 'benchmark';

const suite = new Benchmark.Suite('json-test');

suite.add("parser", () => {
  const result = parser.parse(jsonGraph, input, 'Entry');
}, {
  // minSamples: 100
});

suite.add("combined", () => {
  const result = parser.parse(jsonGraph, input, 'Entry');
  const astIR = ast.transformCSTRoot(result);
  const typedAST = ast.toTypedAST(astIR);
  const data = jsonSemantics.evaluate(typedAST);
}, {
  // minSamples: 100
});

suite.on('cycle', function (event: Benchmark.Event) {
  console.log(String(event.target));
});

suite.run();

// console.time('10');
// for (let i = 0; i < 10; i++)
//   parser.parse(jsonGraph, input, 'Entry');
// console.timeEnd('10');

console.time();
const result = parser.parse(jsonGraph, input, 'Entry');
console.timeEnd();
console.log(JSON.stringify(result).length);

if (result.ok) {
  console.time('transformCSTRoot');
  const astIR = ast.transformCSTRoot(result);
  console.timeEnd('transformCSTRoot');
  console.log(JSON.stringify(astIR).length);
  console.log(JSON.stringify(astIR).slice(0, 50000));
  console.log(JSON.stringify(astIR).slice(-50000));
  console.time('toTypedAST');
  const typedAST = ast.toTypedAST(astIR);
  console.timeEnd('toTypedAST');
  // console.log(JSON.stringify(typedAST).length);
  console.time('jsonSemantics');
  const data = jsonSemantics.evaluate(typedAST);
  console.timeEnd('jsonSemantics');
  console.log(data);
} else {
  console.log(JSON.stringify(result).slice(0, 50000));
  console.log(JSON.stringify(result).slice(-50000));
}
