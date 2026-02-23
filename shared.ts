export const customInspectSymbol = Symbol.for('nodejs.util.inspect.custom');
export class MapView<K, V> implements ReadonlyMap<K, V> {
  get [Symbol.toStringTag]() {
    return 'MapView';
  }
  #map: ReadonlyMap<K, V>;
  constructor(map: ReadonlyMap<K, V>) {
    this.#map = map;
  }

  get(key: K): V | undefined {
    return this.#map.get(key);
  }

  has(key: K): boolean {
    return this.#map.has(key);
  }

  keys() {
    return this.#map.keys();
  }
  values() {
    return this.#map.values();
  }
  entries() {
    return this.#map.entries();
  }
  forEach<S>(callbackfn: (this: S, value: V, key: K, map: MapView<K, V>) => void, thisArg: S): void;
  forEach(callbackfn: (value: V, key: K, map: MapView<K, V>) => void): void;
  forEach(callbackfn: (value: V, key: K, map: MapView<K, V>) => void, thisArg?: any): void {
    const self = this;
    return this.#map.forEach(function (this: any, v, k) {
      return Reflect.apply(callbackfn, this, [v, k, self]);
    }, thisArg);
  }
  get size() {
    return this.#map.size;
  }
  [Symbol.iterator]() {
    return this.#map[Symbol.iterator]();
  }
  [customInspectSymbol]() {
    class MapView extends Map<K, V> {
      get [Symbol.toStringTag]() {
        return 'MapView';
      }
    };
    return new MapView(this);
  }
}

export type UnionToIntersection<U> =
  (U extends any ? (x: U) => void : never) extends ((x: infer I) => void) ? I : never;

// Source - https://stackoverflow.com/a/60437613
// Posted by jcalz
// Retrieved 2026-02-04, License - CC BY-SA 4.0
export type DeepReplace<T, M extends [any, any]> = {
  [P in keyof T]: T[P] extends M[0]
  ? Replacement<M, T[P]>
  : T[P] extends object
  ? DeepReplace<T[P], M>
  : T[P];
};
type Replacement<M extends [any, any], T> =
  M extends any ? [T] extends [M[0]] ? M[1] : never : never;
//

export type Display<T> = T & { [K in never]: never };

export const freeze = Object.freeze;
