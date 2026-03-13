import { ParseFailedError } from "../parser_dist/index.js";

export function getMarkers(model: monaco.editor.ITextModel, ...errs: unknown[]) {
  const markers: monaco.editor.IMarkerData[] = [];
  for (const err of errs) {
    let offset = 0;
    if (err instanceof ParseFailedError)
      offset = err.cause.pos;

    const pos = model.getPositionAt(offset);
    markers.push({
      startLineNumber: pos.lineNumber,
      startColumn: pos.column,
      endLineNumber: pos.lineNumber,
      endColumn: pos.column,
      message: String(err),
      severity: monaco.MarkerSeverity.Error
    });
  }
  return markers;
}
