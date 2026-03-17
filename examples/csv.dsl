csv = (/$/ | row) (/\r?\n|\r/ row)* /\r?\n|\r|$/
row = field (',' field)*
field = {
  quoted = '"' /[^"]*/ ('""' /[^"]*/)* '"'
  clear = !'"' /[^,\r\n]*/
}/
