Entry = Value > json;

Value = {
  obj  = Object
  arr  = Array
  str  = string
  num  = number
  bool = boolean
  null = 'null'
};

Object = (
  '{'
  Items<
    Sep = ',',
    Value = string ':' Value
  >
  '}'
);

Array = (
  '['
  Items<
    Sep = ',',
    Value = Value
  >
  ']'
);

string = '"' stringBody* '"';

stringBody = /([^"\\]|\\(["\\/bfnrt]|u[0-9a-fA-F]{4}))+/;

number = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/;

boolean = /true|false/;

Items = (@Value (@Sep @Value)*)?;
