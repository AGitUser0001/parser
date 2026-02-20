Entry = Value > json;

Value = {
  obj  = Object
  arr  = Array
  str  = string
  num  = number
  bool = boolean
  null = /null/y
};

Object = (
  /\{/
  Items<
    Sep = /,/,
    Value = string /\s*:\s*/ Value
  >
  /\}/
);

Array = (
  /\[/
  Items<
    Sep = /,/,
    Value = Value
  >
  /\]/
);

string = /"/ /[^"]*/ /"/;

number = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/;

boolean = /true|false/;

Items = (@Value (@Sep @Value)*)?;
