// Metagrammar that compiles to grammar
// This version is defined using the metagrammar itself

Grammar = (State ';'?)*

StateObject = prefixes '{' (State_reg ';'?)* '}' #postfixes

State = {
  reg = identifier '=' Choice_outer
  obj = identifier '=' StateObject
}

Choice = {
  outer = '|'? Sequence_outer ('|' Sequence_outer)*
  inner = '|'? Sequence_inner ('|' Sequence_inner)*
}

Sequence = {
  outer = #(!(/\s*\n/ | %/$/) !(!/(?<=\n\s*)/ %/(?<=\n\s*)/) !%/[\]|)}>;,]/ %Term)*
  inner = Term*
}

// Must be Group first, Call before Reference
Term = prefixes (Group | Terminal | Call | Reference)/ #postfixes

Group = '(' Choice_inner ')'

Reference = identifier | generic

Call = identifier '<' Arg (',' Arg)* '>'

Arg = identifier '=' Choice_outer

Terminal = terminal | string

postfixes = postfix*

postfix = /[*?+@/]/

prefixes = prefix*
prefix = /[#%!&$]/

identifier = /[$_\p{ID_Start}](?:[$_\u200C\u200D\p{ID_Continue}])*/u

generic = '@' identifier

terminal = '/' /(?:\\.|[^/\\[\r\n]|\[(?:\\.|[^\]\\\r\n])*\])+/ '/' /[a-z]*/

string = {
  single = "'" /[^']+/ "'" /[a-z]*/
  double = '"' /[^"]+/ '"' /[a-z]*/
}
