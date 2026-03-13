import { Sequence, Choice, type GraphToken } from "../parser_dist/graph.js";
import { Graph } from "../parser_dist/index.js";
import type { StateName } from "../parser_dist/index.js";
import { Panel } from "./elements.js";

export function renderGraph(panel: Panel, graph: Graph<StateName> | null | undefined) {
  panel.content.replaceChildren();
  if (graph == null) {
    const el = document.createElement("div");
    el.textContent = "No graph available.";

    panel.content.appendChild(el);
    return;
  }

  for (const [name, seq] of graph) {
    const el = document.createElement("div");
    el.className = "graph-state";

    const header = document.createElement("div");
    header.className = "graph-header graph-str";
    header.textContent = JSON.stringify(name);

    el.appendChild(header);

    const children = document.createElement("div");
    children.className = "graph-children";

    children.appendChild(renderNode(seq));
    el.appendChild(children);
    header.onclick = () => {
      children.classList.toggle("collapsed");
    }

    panel.content.appendChild(el);
  }
}

function renderNode(node: GraphToken<StateName>): HTMLElement {
  const el = document.createElement("div");
  el.className = "graph-node";

  if (node instanceof Sequence || node instanceof Choice) {
    const header = document.createElement("div");
    header.className = "graph-header";

    const type = node instanceof Sequence ? "Sequence" : "Choice";

    const { ops, body } = node.segments;

    const opsText = ops.size ? ` { ${[...ops].join(" ")} }` : "";

    header.textContent = type + opsText;

    el.appendChild(header);

    const children = document.createElement("div");
    children.className = "graph-children";

    for (const child of body) {
      children.appendChild(renderNode(child));
    }

    el.appendChild(children);
    header.onclick = () => {
      children.classList.toggle("collapsed");
    }

    return el;
  }

  const leaf = document.createElement("div");
  if (node instanceof RegExp) {
    leaf.className = "graph-leaf graph-re";
    leaf.textContent = node.toString();
  } else {
    leaf.className = "graph-leaf graph-str";
    leaf.textContent = JSON.stringify(node);
  }

  el.appendChild(leaf);
  return el;
}

export function renderInspector(panel: Panel, data: unknown, name?: string, fallback: string = 'No data available.') { 
  if (data == undefined) {
    const el = document.createElement('div');
    el.textContent = fallback;
    panel.content.appendChild(el);
    return;
  }
  const inspector = document.createElement('ix-object-inspector');
  inspector.name = name;
  inspector.data = data;
  panel.content.appendChild(inspector);
}
