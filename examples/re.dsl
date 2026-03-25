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
  | escape
  | dot
  | literal

Group = {
  simple = '(' Disjunction ')'
  non_capturing = '(?:' Disjunction ')'
  named_capture = '(?<' ident '>' Disjunction ')'
}

charclass =
    '[' '^'? classitem* ']'

classitem =
    range
  | escape
  | classchar

range = (classchar | escape) '-' (classchar | escape)

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

number = /\d+/
hexNumber = /[\da-f]+/i

// -----------------
// TERMINALS
// -----------------

dot = '.'

escape = '\' escapeitem

escapeitem = {
  numeric = number
  control = 'c' /[a-z]/i
  named_backref = 'k' '<' ident '>'
  unicode = 'u' unicode_escape_value
  hex = 'x' /[\da-f]{2}/i
  char = /[^\dukxc]/
}

unicode_escape_value = {
  four = /[\da-f]{4}/i
  variable = '{' hexNumber '}'
}

literal = !quantifier_repeat_n /[^\\.^$|?*+()[]/

// inside [...]
classchar = /[^\\\]]/

ident = /[$_\p{ID_Start}][$\u200c\u200d\p{ID_Continue}]*/u
