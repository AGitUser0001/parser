import { Sequence, Choice, type GraphToken } from "../parser_dist/graph.js";
import { Graph } from "../parser_dist/index.js";
import type { StateName } from "../parser_dist/index.js";

export function renderGraph(c: HTMLElement, graph: Graph<StateName> | null | undefined) {
  if (graph == null) {
    const el = document.createElement("div");
    el.textContent = "No graph available.";
    el.style.color = 'red';

    c.appendChild(el);
    return;
  }

  if (graph.size < 1) {
    const el = document.createElement("div");
    el.textContent = "Graph is empty.";

    c.appendChild(el);
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

    c.appendChild(el);
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

import { Inspector } from "@observablehq/inspector";
const inspectors = new WeakMap<HTMLElement, Inspector>();
export function renderInspector(c: HTMLElement, data: unknown, name: string, fallback: string = 'No data available.') { 
  if (!inspectors.has(c))
    inspectors.set(c, new Inspector(c));
    
  const inspector = inspectors.get(c)!;
  if (data == undefined) {
    inspector.rejected(fallback);
  } else {
    inspector.fulfilled(data, name);
  }
}

export function renderInspector2(c: HTMLElement, isError: boolean, data: unknown, name: string) { 
  if (!inspectors.has(c))
    inspectors.set(c, new Inspector(c));
    
  const inspector = inspectors.get(c)!;
  if (isError) {
    if (data instanceof Error)
      try { if (data.stack) data = data.stack }
      catch { }
    inspector.rejected(String(data));
  } else {
    inspector.fulfilled(data, name);
  }
}
