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
  outer = #(!/\s*\n/ !(!/(?<=\n\s*)/ %/(?<=\n\s*)/) !%/[\]|)}>;,]/ %Term)*
  inner = Term*
}

// Must be Group first, Call before Reference
Term = (Group | Terminal | Call | Reference)/

Group = prefixes '(' Choice_inner ')' #postfixes

Reference = prefixes (identifier | generic) #postfixes

Call = prefixes identifier '<' Arg (',' Arg)* '>' #postfixes

Arg = identifier '=' Choice_outer

Terminal = prefixes (terminal | string) #postfixes

postfixes = postfix*

postfix = />[A-Za-z0-9_]+(,[A-Za-z0-9_]+)*|[*?+@/]/

prefixes = prefix*
prefix = /[#%!&$]/

identifier = /[$_\p{ID_Start}](?:[$_\u200C\u200D\p{ID_Continue}])*/u

generic = '@' identifier

terminal = '/' /(?:\\.|[^/\\[\r\n]|\[(?:\\.|[^\]\\\r\n])*\])+/ '/' /[a-z]*/

string = {
  single = "'" /[^']+/ "'" /[a-z]*/
  double = '"' /[^"]+/ '"' /[a-z]*/
}
