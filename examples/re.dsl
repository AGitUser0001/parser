// Use /(?:\s+|\/\/.*$|\/\*[\s\S]*?\*\/)+/my as WS_REGEX for whitespace-ignoring behaviour
// Use /(?:)/y for whitespace sensitive behaviour

// Entry point
Pattern = Disjunction

// Alternation
Disjunction = Sequence ('|' Sequence)*

// Concatenation
Sequence = Term*

// A term: assertion OR atom with optional quantifier
Term = {
  assertion = assertion
  atom_quantifier = atom quantifier?
}

// -----------------
// ATOMS
// -----------------

atom =
    Group
  | charclass
  | escaped
  | dot
  | literal

Group =
    '(' Disjunction ')'
  | '(?:' Disjunction ')'        // non-capturing

charclass =
    '[' '^'? classitem* ']'

classitem =
    range
  | escaped
  | classchar

range =
    classchar '-' classchar

// -----------------
// ASSERTIONS
// -----------------

assertion =
    '^'
  | '$'
  | '\\b'
  | '\\B'
  | lookaround

lookaround = '(?' /<?[=!]/ Disjunction ')'

// -----------------
// QUANTIFIERS
// -----------------

quantifier = (quantifier_char | quantifier_repeat_n) '?'?

quantifier_char = /[*+?]/
quantifier_repeat_n = '{' number (',' number?)? '}'

number = /[0-9]+/

// -----------------
// TERMINALS
// -----------------

dot = '.'

escaped = /\\./

literal = /[^\\.^$|?*+()[\]{}]/

// inside [...]
classchar = /[^\\\]\-]/
