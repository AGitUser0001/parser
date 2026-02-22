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
  function walk(node: Result) {
    let len = 0, wslen = 0;
    let wstoken: Token | null = null;

    if (node.ws) {
      len += node.ws.length;
      wslen = node.ws.length;

      tokens.push(wstoken = {
        type: 'ws',
        value: node.ws,
        start: 0,
        end: 0
      });
    }

    switch (node.type) {
      case 'state': {
        let entertoken: Token | null = null;
        tokens.push(entertoken = {
          type: 'enter',
          state: node.state,
          pos: 0
        });

        if (node.value)
          len += walk(node.value);

        tokens.push({
          type: 'exit',
          state: node.state,
          pos: node.pos
        });

        entertoken.pos = node.pos - len + wslen;
        break;
      }

      case 'terminal': {
        if (!node.value)
          break;

        len += node.value.length;
        tokens.push({
          type: 'terminal',
          value: node.value,
          start: node.pos - len + wslen,
          end: node.pos
        });
        break;
      }

      case 'sequence':
      case 'iteration':
        for (const child of node.value)
          len += walk(child);
        break;

      case 'choice':
      case 'attrs':
      case 'rewind':
        len += walk(node.value);
        break;

      case 'none':
      case 'lookahead':
        break;

      case 'root':
        len += walk(node.value);
        if (node.trailing_ws) {
          len += node.trailing_ws.length;

          tokens.push({
            type: 'ws',
            value: node.trailing_ws,
            start: node.pos - node.trailing_ws.length,
            end: node.pos
          });
        }
        break;

      default:
        const _exhaustive: never = node;
        throw new TypeError('Invalid result!', { cause: { node, tokens, len } });
    }

    if (wstoken) {
      wstoken.start = node.pos - len;
      wstoken.end = node.pos - len + wslen;
    }

    return len;
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
