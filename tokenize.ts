import type { StateName } from "./graph.js";
import type { Result, MatcherValue } from "./parser.js";

export type Token =
  | {
    type: 'enter';
    state: StateName;
    pos: number;
  }
  | {
    type: 'exit';
    state: StateName;
    pos: number;
  }
  | {
    type: 'terminal';
    value: MatcherValue;
    start: number;
    end: number;
  }
  | {
    type: 'ws';
    value: MatcherValue;
    start: number;
    end: number;
  };

export function tokenize(root: Result): Token[] {
  const tokens: Token[] = [];
  let cursor = 0;

  function walk(node: Result) {
    // 1. Consume leading whitespace if present
    if (node.ws) {
      const start = cursor;
      const end = cursor + node.ws.length;

      tokens.push({
        type: 'ws',
        value: node.ws,
        start,
        end
      });

      cursor = end;
    }

    switch (node.type) {
      case 'state': {

        tokens.push({
          type: 'enter',
          state: node.state,
          pos: cursor
        });

        if (node.value)
          walk(node.value);

        tokens.push({
          type: 'exit',
          state: node.state,
          pos: cursor
        });

        break;
      }

      case 'terminal': {
        if (!node.value)
          break;
        const value = node.value;
        const start = cursor;
        const end = start + value.length;

        if (node.pos !== end) {
          throw new Error("Cursor mismatch", {
            cause: { cursor, value, node }
          });
        }

        tokens.push({
          type: 'terminal',
          value,
          start,
          end
        });

        cursor = end;
        break;
      }

      case 'sequence':
      case 'iteration':
        for (const child of node.value)
          walk(child);
        break;

      case 'choice':
      case 'attrs':
      case 'rewind':
        walk(node.value);
        break;

      case 'none':
      case 'lookahead':
        break;

      case 'root':
        walk(node.value);
        if (node.trailing_ws) {
          const start = cursor;
          const end = start + node.trailing_ws.length;

          tokens.push({
            type: 'ws',
            value: node.trailing_ws,
            start,
            end
          });

          cursor = end;
        }
        break;

      default:
        const _exhaustive: never = node;
        throw new TypeError('Invalid result!', { cause: { node, tokens, cursor } });
    }
  }

  walk(root);
  return tokens;
}

export type TokenMapperData = {
  token: Token & { type: 'terminal' | 'ws'; };
  state: StateName | null;
  stack: StateName[]; depth: number;
};
export type TokenMapperResult = {
  start: number;
  end: number;
  value: string;
  scopes: string[];
};
export function mapTokens(
  tokens: Token[], source: string,
  mapper: Generator<[textToAdvance: string, scopes: string | string[]] | undefined, unknown, TokenMapperData>
): TokenMapperResult[] {
  const result: TokenMapperResult[] = [];
  const stack: StateName[] = [];
  let currentPos = 0;
  let tokenIndex = 0;

  // The generator response: [textToAdvance, scope] or undefined (requesting next terminal)
  let generatorResponse = mapper.next();

  main: while (!generatorResponse.done) {
    let instruction = generatorResponse.value;

    // 1. If the generator is "waiting" (instruction is undefined), 
    //    we loop through structural tokens until we hit a terminal.
    if (instruction === undefined) {
      while (tokenIndex < tokens.length) {
        const token = tokens[tokenIndex];

        if (token.type === 'enter') {
          stack.push(token.state);
          tokenIndex++;
        } else if (token.type === 'exit') {
          stack.pop();
          tokenIndex++;
        } else if (token.type === 'terminal' || token.type === 'ws') {
          // We found the terminal the generator was waiting for.
          // Pass it in and break the structural loop.
          generatorResponse = mapper.next({
            token,
            state: stack.length ? stack[stack.length - 1] : null,
            stack: stack.slice(),
            depth: stack.length
          });
          tokenIndex++;
          continue main;
        }
      }
      // No tokens left
      generatorResponse = mapper.next();
      continue;
    }

    // 2. If the generator provided an instruction, process the styled text.
    if (instruction !== undefined) {
      const [textToAdvance, scopes] = instruction;

      // VALIDATION: Check global alignment
      const expectedText = source.substring(currentPos, currentPos + textToAdvance.length);
      if (textToAdvance !== expectedText) {
        throw new Error(`Sync Error: Expected "${textToAdvance}" at ${currentPos}, found "${expectedText}"`);
      }

      result.push({
        start: currentPos,
        end: currentPos + textToAdvance.length,
        value: textToAdvance,
        scopes: Array.isArray(scopes) ? scopes : [scopes]
      });

      currentPos += textToAdvance.length;

      generatorResponse = mapper.next();
    }
  }

  return result;
}
