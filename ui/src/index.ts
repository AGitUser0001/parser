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

const grammarPanel = new Panel(
  document.getElementById("grammar-panel")!
);

const parserPanel = new Panel(
  document.getElementById("parser-panel")!
);

const grammarModel = monaco.editor.createModel('', 'plaintext');
grammarPanel.addTab("Grammar", grammarModel);
grammarPanel.addTab("Graph");

const semanticsModel = monaco.editor.createModel(`{
  State(child1, child2, child3) {
    return this(child1) + this(child3);
  }
}`, 'javascript');
grammarPanel.addTab("Semantics", semanticsModel);
grammarPanel.addTab("Emit");

const inputModel = monaco.editor.createModel('', 'plaintext');
parserPanel.addTab("Input", inputModel);
parserPanel.addTab("CST");
parserPanel.addTab("Parse Tree");
parserPanel.addTab("Tokens");
parserPanel.addTab("Semantics Result");
