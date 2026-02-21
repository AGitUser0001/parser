// Metagrammar that compiles to grammar
// This version is defined using the metagrammar itself

Grammar = (State ';'?)*

StateObject = '{' (State_reg ';'?)* '}'

State = {
  reg = identifier '=' Choice_outer
  obj = identifier '=' StateObject
}

Choice = {
  outer = '|'? Sequence_outer ('|' Sequence_outer)*
  inner = '|'? Sequence_inner ('|' Sequence_inner)*
}

Sequence = {
  outer = #(!(!/(?<=\n\s*)/ %/(?<=\n\s*)/) !%/[\]|)}>;,]/ %Term)*
  inner = Term*
}

Term = Group | Reference | Terminal | Call

Group = prefixes '(' Choice_inner ')' #postfixes

Reference = prefixes (identifier | generic) #postfixes

Call = prefixes identifier '<' Arg (',' Arg)* '>' #postfixes

Arg = identifier '=' Choice_outer

Terminal = prefixes (terminal | string) #postfixes

postfixes = postfix*

postfix = />\s*[A-Za-z0-9_]+(\s*,\s*[A-Za-z0-9_]+)*|[*?+@]/

prefixes = prefix*

prefix = /[#%!&$]/

identifier = /[A-Za-z_][A-Za-z0-9_]*/

generic = /@[A-Za-z_][A-Za-z0-9_]*/

terminal = '/' /(?:\\.|[^/\\[]|\[(?:\\.|[^\]\\])*\])+/ '/' /[a-z]*/

string = {
  single = "'" /[^']+/ "'"
  double = '"' /[^"]+/ '"'
}
