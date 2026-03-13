/*!
MIT License

Copyright (c) 2023 Samantha

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
// https://github.com/elliniaresearch/types-ohq-d3/blob/main/packages/observablehq_inspector/index.d.ts

/**
 * This library implements the default value renderer for Observable programs.
 * When used with the [Observable runtime](https://github.com/observablehq/runtime)
 * as [observers](https://github.com/observablehq/runtime/blob/main/README.md#observers),
 * inspectors can insert elements into the DOM and render interactive displays
 * for arbitrary values.
 */
declare module '@observablehq/inspector' {
	/**
	 * An inspector implements the Observable runtime’s [*Observer* interface](https://github.com/observablehq/runtime/blob/main/README.md#observers)
	 * by rendering the current value of its associated [variable](https://github.com/observablehq/runtime/blob/main/README.md#variables)
	 * to a given DOM element. Inspectors display DOM elements “as-is”,
	 * and create interactive “devtools”-style inspectors for other
	 * arbitrary values such as numbers and objects.
	 */
	export class Inspector {
		/**
		 * Creates a new inspector attached to the specified DOM *element*.
		 */
		constructor(node: Element);

		/**
		 * Applies the `observablehq--running` class to this inspector’s *element*.
		 */
		pending(): void;

		/**
		 * Inspects the specified *value*, replacing the contents of this inspector’s
		 * *element* as appropriate, and dispatching an *update* event. If the specified
		 * *value* is a DOM element or text node, and the *value* is not already attached
		 * to the DOM, it is inserted into this inspector’s *element*, replacing any
		 * existing contents. Otherwise, for other arbitrary values such as numbers,
		 * arrays, or objects, an expandable display of the specified *value* is generated
		 * into this inspector’s *element*.
		 * 
		 * Applies the `observablehq` class to this inspector’s *element*, and for
		 * non-element *value*s, the `observablehq--inspect` class.
		 */
		fulfilled<T>(value: T, name: string): void;

		/**
		 * Inspects the specified *error*, replacing the contents of this inspector’s
		 * *element* as appropriate with the error’s description, and dispatching an
		 * *error* event.
		 * 
		 * Applies the `observablehq` and `observablehq--error` class to this inspector’s
		 * *element*.
		 */
		rejected(error: string): void;

		/**
		 * Returns a function that when passed a given [*variable*](https://github.com/observablehq/runtime/blob/main/README.md#variables),
		 * returns a new {@link Inspector} attached to a new DIV element within
		 * the specifier *container* element.
		 * 
		 * If *container* is a string, it represents a selector, and the *container* element
		 * becomes the matching selected element.
		 * 
		 * This method can be used with [an Observable module definition](https://github.com/observablehq/runtime/blob/main/README.md#_define)
		 * as the observer factory to conveniently render an entire program.
		 */
		static into<T>(container: T): () => Inspector;
	}
}
