import { input_to_graph, graph_to_input, build, transformCSTRoot, toTypedAST, Semantics, type AllASTNodes, emit, type ParserFn, type GraphStates, tokenize } from '../../dist/index.js';
let util, readFile, writeFile;
if (typeof global !== 'undefined') {
  util = await import('node:util');
  ({ readFile, writeFile } = await import('node:fs/promises'));
}

// -----------------------------------------------------------------------

const RUN_NATIVE = true;
const LOG_GRAPH = false;
const LOG_NUMBERS = true;
const RUN_N = 10;
const RUN_BENCHMARK = false;
const LOG_ASTIR = false;
const LOG_DATA = false;
const RUN_EMIT = true;
const WRITE_EMIT = true;
const EMIT_PATH = './json_parser.js';

const input = await (await fetch('https://microsoftedge.github.io/Demos/json-dummy-data/5MB.json')).text();
// const input = readFile ? await readFile('./json_sample1k.json', 'utf-8') : await (await fetch('./json_sample1k.json')).text();

// -----------------------------------------------------------------------
if (LOG_NUMBERS)
  console.log('Input: ', input.length);

//#region define
const jsonStates = {
  Entry: [
    'Value'
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

  null: /null/
} as const;
const jsonGraph = input_to_graph<keyof typeof jsonStates>(jsonStates);
//#endregion

if (LOG_GRAPH && util) {
  console.log(util.inspect(jsonGraph, {
    depth: 10
  }));
  console.log(util.inspect(graph_to_input(jsonGraph), {
    depth: 10
  }));
}

//#region semantics
const jsonSemantics = new Semantics(jsonGraph, {
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

let parseJSON: ParserFn<GraphStates<typeof jsonGraph>>;
if (WRITE_EMIT && writeFile) {
  console.time('build');
  const parser = build(jsonGraph, true);
  console.timeEnd('build');
  console.time('emit');
  const emitted = emit(parser);
  console.timeEnd('emit');
  await writeFile(EMIT_PATH, emitted);
}
if (!RUN_EMIT) {
  console.time('build');
  parseJSON = build(jsonGraph);
  console.timeEnd('build');
} else {
  console.time('import');
  let s = EMIT_PATH;
  parseJSON = (await import(s)).parse;
  console.timeEnd('import');
}

const { default: Benchmark } = typeof global === 'undefined' ? (await import('https://esm.sh/benchmark' as string)) as { default: typeof import('benchmark') } : await import('benchmark');
if (typeof global === 'undefined') (window as any).Benchmark = Benchmark;

const suite = new Benchmark.Suite('json-test');

const tests = [() => suite.add("combined", () => {
  const result = parseJSON(input, 'Entry');
  const astIR = transformCSTRoot(result);
  const typedAST = toTypedAST(astIR);
  const data = jsonSemantics.evaluate(typedAST);
  data;
}), () => suite.add("parser", () => {
  const result = parseJSON(input, 'Entry');
  result;
}), () => suite.add("parse_tokenize", () => {
  const result = parseJSON(input, 'Entry');
  const tokens = tokenize(result);
  tokens;
})].map(value => ({ value, sort: Math.random() }))
  .sort((a, b) => a.sort - b.sort)
  .map(({ value }) => value);
tests.forEach(t => t());

suite.on('cycle', function (event: import('benchmark').Event) {
  console.log(String(event.target));
});

if (RUN_N > 0) {
  console.time(String(RUN_N + ' parses'));
  for (let i = 0; i < RUN_N; i++)
    parseJSON(input, 'Entry');
  console.timeEnd(String(RUN_N + ' parses'));

  console.time(String(RUN_N + ' parse + ast + semantics'));
  for (let i = 0; i < RUN_N; i++) {
    const result = parseJSON(input, 'Entry');
    const astIR = transformCSTRoot(result);
    const typedAST = toTypedAST(astIR);
    jsonSemantics.evaluate(typedAST);
  }
  console.timeEnd(String(RUN_N + ' parse + ast + semantics'));
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

  console.time('tokenize');
  const tokens = tokenize(result);
  console.timeEnd('tokenize');

  if (LOG_NUMBERS)
    console.log('Tokens#: ', tokens.length, ' Tokens: ', JSON.stringify(tokens).length);

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
