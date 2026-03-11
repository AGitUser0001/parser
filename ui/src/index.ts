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
import { Panel } from './elements.js';
import { State } from './state.js';

const state = new State();

const grammarPanel = new Panel(
  document.getElementById("grammar-panel")!
);

const parserPanel = new Panel(
  document.getElementById("parser-panel")!
);

const grammarModel = monaco.editor.createModel('', 'plaintext');
grammarModel.onDidChangeContent(() => {
  state.input = grammarModel.getValue();

  state.compile().then(() => {
    if (grammarPanel.current_tab === "Graph") {
      // renderGraph();
    }
  });
});
grammarPanel.addTab('grammar', "Grammar", grammarModel);
grammarPanel.addTab('graph', "Graph");

const semanticsModel = monaco.editor.createModel(`{
  State(child1, child2, child3) {
    return this(child1) + this(child3);
  }
}`, 'javascript');
grammarPanel.addTab('semanticsCode', "Semantics", semanticsModel);
grammarPanel.addTab('emit', "Emit");

const inputModel = monaco.editor.createModel('', 'plaintext');
parserPanel.addTab('input', "Input", inputModel);
parserPanel.addTab('cst', "CST");
parserPanel.addTab('parseTree', "Parse Tree");
parserPanel.addTab('tokens', "Tokens");
parserPanel.addTab('semanticsResult', "Semantics Result");
