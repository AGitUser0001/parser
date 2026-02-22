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
  outer = #(!/\s*\n/ !(!/(?<=\n\s*)/ %/(?<=\n\s*)/) !%/[\]|)}>;,]/ %Term)*
  inner = Term*
}

Term = /(Group | Terminal | Call | Reference)

Group = group_prefixes '(' Choice_inner ')' #postfixes

Reference = prefixes (identifier | generic) #postfixes

Call = prefixes identifier '<' Arg (',' Arg)* '>' #postfixes

Arg = identifier '=' Choice_outer

Terminal = prefixes (terminal | string) #postfixes

postfixes = postfix*

postfix = />[A-Za-z0-9_]+(,[A-Za-z0-9_]+)*|[*?+@]/

prefixes = prefix*
prefix = /[#%!&$]/

group_prefixes = (prefix | ordered_choice_operator)*
ordered_choice_operator = '/'

identifier = /[A-Za-z_][A-Za-z0-9_]*/

generic = /@[A-Za-z_][A-Za-z0-9_]*/

terminal = '/' /(?:\\.|[^/\\[]|\[(?:\\.|[^\]\\])*\])+/ '/' /[a-z]*/

string = {
  single = "'" /[^']+/ "'"
  double = '"' /[^"]+/ '"'
}
