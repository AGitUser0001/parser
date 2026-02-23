// Metagrammar that compiles to grammar
// This version is defined using the metagrammar itself

Grammar = (State ';'?)*

StateObject = group_prefixes '{' (State_reg ';'?)* '}' #postfixes

State = /{
  /**
    *  State_obj must be first for some cases on a single line:
    *  ```
    *  State = /{}; A = /1/
    *  ````
    * If State_obj is second; this will parse as
    * "State" "=" "/" "{}; A = /1" "/"
    */
  obj = identifier '=' StateObject
  reg = identifier '=' Choice_outer
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

terminal = '/' /(?:\\.|[^/\\[\r\n]|\[(?:\\.|[^\]\\\r\n])*\])+/ '/' /[a-z]*/

string = {
  single = "'" /[^']+/ "'" /[a-z]*/
  double = '"' /[^"]+/ '"' /[a-z]*/
}
