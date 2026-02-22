Entry = Value > json;

Value =
  | Object
  | Array
  | string
  | number
  | boolean
  | null;

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

null = 'null';
