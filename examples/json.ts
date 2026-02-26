import { input_to_graph, graph_to_input, build, transformCSTRoot, toTypedAST, Semantics, type AllASTNodes } from 'parser';

// -----------------------------------------------------------------------

const RUN_NATIVE = true;
const LOG_GRAPH = false;
const LOG_NUMBERS = true;
const RUN_N = 10;
const RUN_BENCHMARK = false;
const LOG_ASTIR = false;
const LOG_DATA = false;

const input = await (await fetch('https://microsoftedge.github.io/Demos/json-dummy-data/5MB.json')).text();
// const input = await readFile('./json_sample1k.json', 'utf-8');
console.log('Input: ', input.length);

// -----------------------------------------------------------------------

//#region define
const jsonStates = {
  Entry: [
    'Value>json'
  ],
  Value: [['/', 'Object', 'Array', 'string', 'number', 'boolean', 'null']],
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

  null: 'null'
} as const;
const jsonGraph = input_to_graph<keyof typeof jsonStates>(jsonStates);
//#endregion

import util from 'node:util';
import { readFile } from 'node:fs/promises';

if (LOG_GRAPH) {
  console.log(util.inspect(jsonGraph, {
    depth: 10
  }));
  console.log(util.inspect(graph_to_input(jsonGraph), {
    depth: 10
  }));
}

//#region semantics
const jsonSemantics = new Semantics('json', jsonGraph, {
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
    const pairs: AllASTNodes[][] = this(items);

    const obj: Record<string, any> = {};
    for (const [key, _colon, value] of pairs) {
      obj[this(key)] = this(value);
    }
    return obj;
  },

  Array(_s1, items, _s2): any[] {
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

  null(_null) {
    return null;
  }
});
//#endregion

if (RUN_NATIVE) {
  console.time('Native');
  try {
    JSON.parse(input);
  } catch (e) {
    console.log(e);
  }
  console.timeEnd('Native');
}

console.time('build');
let parseJSON = build(jsonGraph);
console.timeEnd('build');

import Benchmark from 'benchmark';

const suite = new Benchmark.Suite('json-test');

suite.add("combined", () => {
  const result = parseJSON(input, 'Entry');
  const astIR = transformCSTRoot(result);
  const typedAST = toTypedAST(astIR);
  const data = jsonSemantics.evaluate(typedAST);
  data;
});

suite.add("parser", () => {
  const result = parseJSON(input, 'Entry');
});

suite.on('cycle', function (event: Benchmark.Event) {
  console.log(String(event.target));
});

if (RUN_N > 0) {
  console.time(String(RUN_N));
  for (let i = 0; i < RUN_N; i++)
    parseJSON(input, 'Entry');
  console.timeEnd(String(RUN_N));
}

if (RUN_BENCHMARK)
  suite.run();

console.time('parse');
const result = parseJSON(input, 'Entry');
console.timeEnd('parse');
if (LOG_NUMBERS)
  console.log('Result: ', JSON.stringify(result).length);

if (result.ok) {
  console.time('transformCSTRoot');
  const astIR = transformCSTRoot(result);
  console.timeEnd('transformCSTRoot');

  if (LOG_NUMBERS)
    console.log('ASTIR: ', JSON.stringify(astIR).length);

  if (LOG_ASTIR) {
    console.log(JSON.stringify(astIR).slice(0, 50000));
    console.log(JSON.stringify(astIR).slice(-50000));
  }

  console.time('toTypedAST');
  const typedAST = toTypedAST(astIR);
  console.timeEnd('toTypedAST');

  console.time('jsonSemantics');
  const data = jsonSemantics.evaluate(typedAST);
  console.timeEnd('jsonSemantics');

  if (LOG_DATA)
    console.log(data);
} else {
  console.log(JSON.stringify(result).slice(0, 50000));
  console.log(JSON.stringify(result).slice(-50000));
}
