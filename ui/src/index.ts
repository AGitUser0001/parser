/// <reference path="../globals.d.ts" preserve="true" />
/// <reference path="../../node_modules/inspector-elements/lib/object-inspector/object-inspector.d.ts" preserve="true" />
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
import { ButtonOverlay, Panel } from './elements.js';
import { renderGraph,renderInspector } from './render.js';
import { State, Stream, type Handle } from './state.js';
import { getMarkers } from './utils.js';
import 'inspector-elements';

const state = new State();

const grammarPanel = new Panel(
  document.getElementById("grammar-panel")!
);

const parserPanel = new Panel(
  document.getElementById("parser-panel")!
);

type CompiledType = Awaited<ReturnType<State['compile']>>;
type ParsedType = Awaited<ReturnType<State['parse']>>;
const streams = {
  grammar: new Stream<string>(),
  compiled: new Stream<{ data?: CompiledType, err?: unknown }>(),
  input: new Stream<{ input: string, parser?: Handle<'parser'> }>(),
  parsed: new Stream<{ data?: ParsedType, err?: unknown }>(),
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
})
let compiled: CompiledType | null = null;
streams.compiled.subscribe(({ data, err }, token) => {
  if (!data) {
    compiled?.parser.dispose();
    compiled = null;
    monaco.editor.setModelMarkers(grammarModel, 'compile', getMarkers(grammarModel, err));
    return;
  }
  compiled?.parser.dispose();
  compiled = data;
}, (_, token) => {
  if (grammarPanel.current_tab === 'graph') {
    grammarPanel.refresh();
  }
  const input = inputModel.getValue();
  streams.input.update({ input, parser: compiled?.parser }, token);
});

grammarPanel.addTab('graph', "Graph", null, () => {
  renderGraph(grammarPanel, compiled?.graph);
});

const semanticsModel = monaco.editor.createModel(`{
  State(child1, child2, child3) {
    return this(child1) + this(child3);
  }
}`, 'javascript');
grammarPanel.addTab('semanticsCode', "Semantics", semanticsModel);
grammarPanel.addTab('emit', "Emit");

const inputModel = monaco.editor.createModel('', 'plaintext');
parserPanel.addTab('input', "Input", inputModel);
inputModel.onDidChangeContent(() => {
  const input = inputModel.getValue();
  streams.input.update({ input, parser: compiled?.parser }, null);
});

let start = 'Entry', ws = '';
streams.input.subscribe(({ input, parser }, token) => {
  monaco.editor.setModelMarkers(inputModel, 'parse', []);
  if (!parser) {
    streams.parsed.update({}, token);
    return;
  }
  try {
    state.parse(parser, input, start, eval(ws)).then(
      data => streams.parsed.update({ data }, token),
      err => streams.parsed.update({ err }, token)
    );
  } catch (err) {
    streams.parsed.update({ err }, token);
  }
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
}, () => {
  if (parserPanel.current_tab != null && [
    'parse', 'parseTree', 'tokens'
  ].includes(parserPanel.current_tab)) {
    parserPanel.refresh();
  }
});

parserPanel.addTab('parse', "Parse", null, () => {
  renderInspector(parserPanel, parsed?.result, 'Parse Result');
});
parserPanel.addTab('parseTree', "Parse Tree", null, () => {
  renderInspector(parserPanel, parsed?.parseTree, 'Parse Tree');
});
parserPanel.addTab('tokens', "Tokens", null, () => {
  renderInspector(parserPanel, parsed?.tokens, 'Tokens');
});

const semanticsCtxModel = monaco.editor.createModel(`undefined`, 'javascript');

const semanticsRunOverlay = new ButtonOverlay('<span class="codicon codicon-play"></span> Run',
  () => {
    console.log('test');
  });

parserPanel.meditor.onDidChangeModel(e => {
  if (e.newModelUrl === semanticsCtxModel.uri)
    parserPanel.meditor.addOverlayWidget(semanticsRunOverlay);
  else
    parserPanel.meditor.removeOverlayWidget(semanticsRunOverlay);
})

parserPanel.addTab('semanticsResult', "Semantics Result", semanticsCtxModel, () => {
  parserPanel.content.appendChild(
    document.createElement('pre')
  );
  return true;
});
