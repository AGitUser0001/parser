import { ParseFailedError } from "../parser_dist/index.js";

export function getMarkers(model: monaco.editor.ITextModel, ...errs: unknown[]) {
  const markers: monaco.editor.IMarkerData[] = [];
  for (let err of errs) {
    let offset = 0;
    if (err instanceof ParseFailedError)
      offset = err.cause.pos;

    if (err instanceof Error)
      try { if (err.stack) err = err.stack }
      catch { }

    const pos = model.getPositionAt(offset);
    markers.push({
      startLineNumber: pos.lineNumber,
      startColumn: pos.column,
      endLineNumber: pos.lineNumber,
      endColumn: pos.column + 1,
      message: String(err),
      severity: monaco.MarkerSeverity.Error
    });
  }
  return markers;
}
