csv = (/$/ | row) (/\r?\n|\r/ row)* /\r?\n|\r|$/
row = field (',' field)*
field = {
  quoted = '"' /[^"\r\n]*/ ('""' /[^"\r\n]*/)* '"'
  clear = /[^,\r\n]*/
}/
