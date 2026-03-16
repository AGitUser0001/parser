/// <reference path="../globals.d.ts" preserve="true" />
//#region Loading monaco-editor
await new Promise<void>(r => {
  require.config({
    paths: {
      vs: "../../node_modules/monaco-editor/min/vs/"
    }
  });
  require(["vs/editor/editor.main"], r);
});
//#endregion
import type { Graph, RootNode, StateName } from '../parser_dist/index.js';
import { validateResult } from '../parser_dist/index.js';
import { ButtonOverlay, Panel } from './elements.js';
import { renderGraph, renderInspector, renderInspector2 } from './render.js';
import { MergeStream, WorkerState, LocalState, Stream, type Handle, type State } from './state.js';
import { getMarkers } from './utils.js';

const state: State = new WorkerState();

const grammarPanel = new Panel(
  document.getElementById("grammar-panel")!
);

const parserPanel = new Panel(
  document.getElementById("parser-panel")!
);

type CompiledType = Awaited<ReturnType<State['compile']>>;
type ParsedType = Awaited<ReturnType<State['parse']>>;
type SemanticsType = Awaited<ReturnType<State['compileSemantics']>>;
type SemanticsRunData = { semantics: Handle<'semantics'>, parseTree: RootNode, jsCtx: string };
const streams = {
  grammar: new Stream<string>(),
  compiled: new Stream<{ data?: CompiledType, err?: unknown }>(),
  emitted: new Stream<string>(),
  input: new MergeStream<{ input: string, parser: Handle<'parser'>, start: string, ws?: RegExp }>(),
  parsed: new Stream<{ data?: ParsedType, err?: unknown }>(),
  semanticsCode: new MergeStream<{ input: string, graph: Graph<StateName>, enable_memoization: boolean }>(),
  compiledSemantics: new Stream<{ data?: SemanticsType, err?: unknown }>(),
  semanticsRunData: new MergeStream<SemanticsRunData>(),
  triggerSemanticsRun: new Stream<Partial<SemanticsRunData>>(),
  semanticsRunResult: new Stream<{ ok: boolean, data: unknown }>(),
  config: new Stream<string>(),
  configParsed: new Stream<{
    data?: {
      start: string,
      ws: RegExp | undefined,
      semantics_enable_memoization: boolean | undefined,
      color_scheme: string | undefined
    }, err?: unknown
  }>()
};

const grammarModel = monaco.editor.createModel('', 'plaintext');
grammarPanel.addTab('grammar', "Grammar", grammarModel);
grammarModel.onDidChangeContent(() => {
  const dslCode = grammarModel.getValue();
  streams.grammar.update(dslCode, null);
});
streams.grammar.subscribe((dslCode, token) => {
  monaco.editor.setModelMarkers(grammarModel, 'compile', []);
  state.compile(dslCode).then(
    data => streams.compiled.update({ data }, token),
    err => streams.compiled.update({ err }, token)
  );
});
let compiled: CompiledType | null = null;
let emitted: string = '';
streams.compiled.subscribe(({ data, err }, token) => {
  if (!data) {
    if (compiled?.parser)
      state.dispose(compiled?.parser);
    compiled = null;
    monaco.editor.setModelMarkers(grammarModel, 'compile', getMarkers(grammarModel, err));
    return;
  }
  if (compiled?.parser)
    state.dispose(compiled?.parser);
  compiled = data;
}, (_, token) => {
  grammarPanel.refresh('graph');
  streams.input.update('parser', compiled?.parser, token);
  streams.semanticsCode.update('graph', compiled?.graph, token);
}, (_, token) => {
  if (!compiled) {
    streams.emitted.update('', token);
    return;
  }
  state.emit(compiled.parser).then(
    str => streams.emitted.update(str, token)
  );
});

streams.emitted.subscribe(code => {
  emitted = code;
  grammarPanel.refresh('emit');
});

grammarPanel.addTab('graph', "Graph", null, (c) => {
  renderGraph(c, compiled?.graph);
});

const semanticsModel = monaco.editor.createModel(`return {
  State(child1, child2, child3) {
    return this(child1) + this(child3);
  }
}`, 'javascript');
grammarPanel.addTab('semanticsCode', "Semantics", semanticsModel);

semanticsModel.onDidChangeContent(() => {
  const jsCode = semanticsModel.getValue();
  streams.semanticsCode.update('input', jsCode, null);
});
streams.semanticsCode.subscribe((
  { graph, input: jsCode, enable_memoization }, token
) => {
  monaco.editor.setModelMarkers(semanticsModel, 'compileSemantics', []);
  if (graph == null || jsCode == null) {
    streams.compiledSemantics.update({}, token);
    return;
  }
  state.compileSemantics(graph, jsCode, enable_memoization ?? false).then(
    data => streams.compiledSemantics.update({ data }, token),
    err => streams.compiledSemantics.update({ err }, token)
  );
});

streams.compiledSemantics.subscribe((value, token) => {
  const { data, err } = value;
  streams.semanticsRunData.update('semantics', data, token);
  if (!data) {
    if ('err' in value)
      monaco.editor.setModelMarkers(semanticsModel, 'compileSemantics', getMarkers(semanticsModel, err));
    return;
  }
});

const emitModel = monaco.editor.createModel('', 'javascript');

grammarPanel.meditor.onDidChangeModel(e => {
  if (e.newModelUrl === emitModel.uri)
    grammarPanel.meditor.updateOptions({ readOnly: true });
  else
    grammarPanel.meditor.updateOptions({ readOnly: false });
});

grammarPanel.addTab('emit', "Emit", emitModel, () => {
  emitModel.setValue(emitted);
  return false;
});

const configModel = monaco.editor.createModel(`return {
  start: "Entry",
  ws: undefined,
  semantics_enable_memoization: false,
  color_scheme: 'light dark'
}`, 'javascript');
grammarPanel.addTab('config', "Config", configModel);
configModel.onDidChangeContent(() => {
  const jsCode = configModel.getValue();
  streams.config.update(jsCode, null);
});

streams.config.subscribe((jsCode, token) => {
  monaco.editor.setModelMarkers(configModel, 'eval', []);
  try {
    const fn = new Function(jsCode);
    const result = fn();
    let { start, ws, semantics_enable_memoization, color_scheme } = result;
    if (typeof start !== 'string')
      throw new TypeError(`config.start must be a string!`, { cause: result });
    if (ws != undefined && !(ws instanceof RegExp))
      throw new TypeError(`config.ws must be a RegExp or unset!`, { cause: result });
    if (semantics_enable_memoization != undefined && typeof semantics_enable_memoization !== 'boolean')
      throw new TypeError(`config.semantics_enable_memoization must be a boolean or unset!`, { cause: result });
    if (color_scheme != undefined && typeof color_scheme !== 'string')
      throw new TypeError(`config.color_scheme must be a string or unset!`, { cause: result });

    const data = {
      start, ws: (ws ?? undefined) as RegExp | undefined,
      semantics_enable_memoization: (semantics_enable_memoization ?? undefined) as boolean | undefined,
      color_scheme: (color_scheme ?? undefined) as string | undefined
    };
    streams.configParsed.update({ data }, token);
  } catch (err) {
    streams.configParsed.update({ err }, token);
  }
});

streams.configParsed.subscribe(({ data, err }, token) => {
  if (!data) {
    monaco.editor.setModelMarkers(configModel, 'eval', getMarkers(configModel, err));
    streams.input.update('start', undefined, token);
    streams.input.update('ws', undefined, token);
    streams.semanticsCode.update('enable_memoization', undefined, token);
    document.documentElement.style.colorScheme = '';
    return;
  }
  streams.input.update('start', data.start, token);
  streams.input.update('ws', data.ws, token);
  streams.semanticsCode.update('enable_memoization', data.semantics_enable_memoization, token);
  document.documentElement.style.colorScheme = data.color_scheme ?? '';
});

const inputModel = monaco.editor.createModel('', 'plaintext');
parserPanel.addTab('input', "Input", inputModel);
inputModel.onDidChangeContent(() => {
  const input = inputModel.getValue();
  streams.input.update('input', input, null);
});

streams.input.subscribe(({ input, parser, start, ws }, token) => {
  monaco.editor.setModelMarkers(inputModel, 'parse', []);
  if (parser == null || input == null || start == null) {
    streams.parsed.update({}, token);
    return;
  }
  state.parse(parser, input, start, ws).then(
    data => streams.parsed.update({ data }, token),
    err => streams.parsed.update({ err }, token)
  );
});
let parsed: ParsedType | null = null;
streams.parsed.subscribe((value, token) => {
  const { data, err } = value;
  if (!data) {
    parsed = null;
    if ('err' in value)
      monaco.editor.setModelMarkers(inputModel, 'parse', getMarkers(inputModel, err));
    return;
  }
  parsed = data;
  try {
    validateResult(data.result, compiled?.graph);
  } catch (err) {
    monaco.editor.setModelMarkers(inputModel, 'parse', getMarkers(inputModel, err));
  }
}, (_, token) => {
  parserPanel.refresh('parse');
  parserPanel.refresh('parseTree');
  parserPanel.refresh('tokens');
  streams.semanticsRunData.update('parseTree', parsed?.parseTree, token);
});

parserPanel.addTab('parse', "Parse", null, (c) => {
  renderInspector(c, parsed?.result, 'Parse Result');
});
parserPanel.addTab('parseTree', "Parse Tree", null, (c) => {
  renderInspector(c, parsed?.parseTree, 'Parse Tree');
});
parserPanel.addTab('tokens', "Tokens", null, (c) => {
  renderInspector(c, parsed?.tokens, 'Tokens');
});

const semanticsCtxModel = monaco.editor.createModel(`return undefined`, 'javascript');
semanticsCtxModel.onDidChangeContent(() => {
  const jsCtx = semanticsCtxModel.getValue();
  streams.semanticsRunData.update('jsCtx', jsCtx, null);
});

let semanticsRunResult: { ok: boolean, data: unknown } = {
  ok: false, data: 'Semantics has not been run.'
};
streams.triggerSemanticsRun.subscribe(({ semantics, parseTree, jsCtx }, token) => {
  if (semantics == null && parseTree == null)
    streams.semanticsRunResult.update({ ok: false, data: 'Missing Semantics and parse tree.' }, token);
  else if (semantics == null)
    streams.semanticsRunResult.update({ ok: false, data: 'Missing Semantics.' }, token);
  else if (parseTree == null)
    streams.semanticsRunResult.update({ ok: false, data: 'Missing parse tree.' }, token);
  else {
    state.runSemantics(semantics, parseTree, jsCtx ?? '').then(
      data => streams.semanticsRunResult.update({ ok: true, data }, token),
      err => streams.semanticsRunResult.update({ ok: false, data: err }, token)
    );
  }
})
streams.semanticsRunResult.subscribe(res => {
  semanticsRunResult = res;
  parserPanel.refresh('semanticsResult');
});

const semanticsRunOverlay = new ButtonOverlay('<span class="codicon codicon-play"></span> Run',
  () => {
    streams.triggerSemanticsRun.update(semanticsRunData, null);
  });

let semanticsRunData: Partial<SemanticsRunData> = {};
streams.semanticsRunData.subscribe(data => {
  if (semanticsRunData.semantics !== data.semantics)
    if (semanticsRunData.semantics)
      state.dispose(semanticsRunData.semantics);

  semanticsRunData = data;
});

parserPanel.meditor.onDidChangeModel(e => {
  if (e.newModelUrl === semanticsCtxModel.uri)
    parserPanel.meditor.addOverlayWidget(semanticsRunOverlay);
  else
    parserPanel.meditor.removeOverlayWidget(semanticsRunOverlay);
})

parserPanel.addTab('semanticsResult', "Semantics Result", semanticsCtxModel, (c) => {
  renderInspector2(c, !semanticsRunResult.ok, semanticsRunResult.data, 'Semantics Result');
});

streams.config.update(configModel.getValue(), null);
streams.semanticsRunData.update('jsCtx', semanticsCtxModel.getValue(), null);
streams.semanticsCode.update('input', semanticsModel.getValue(), null);
streams.input.update('input', inputModel.getValue(), null);
streams.grammar.update(grammarModel.getValue(), null);

// -- Theme --

const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)');
systemPrefersDark.addEventListener('change', () => {
  updateMonacoTheme();
});

const DARK_THEME = 'vs-dark';
const LIGHT_THEME = 'vs';

function updateMonacoTheme() {
  const colorScheme = window.getComputedStyle(document.documentElement).colorScheme;
  const currentTheme = (grammarPanel.meditor as any)._themeService._theme.themeName as string;
  const darKTheme = currentTheme.includes('hc') ? 'hc-black' : DARK_THEME;
  const lightTheme = currentTheme.includes('hc') ? 'hc-light' : LIGHT_THEME;

  if (colorScheme.includes('light') && colorScheme.includes('dark')) {
    monaco.editor.setTheme(systemPrefersDark.matches ? darKTheme : lightTheme);
    document.documentElement.setAttribute('data-theme', systemPrefersDark.matches ? 'dark' : 'light');
  } else if (colorScheme.includes('dark')) {
    monaco.editor.setTheme(darKTheme);
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    monaco.editor.setTheme(lightTheme);
    document.documentElement.setAttribute('data-theme', 'light');
  }
};

updateMonacoTheme();
const observer = new MutationObserver(() => {
  updateMonacoTheme();
});

observer.observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['style', 'class']
});

