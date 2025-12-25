export {};

// Minimal polyfills for older WebKitGTK runtimes (common on some Linux distros).

if (typeof (Promise as any).allSettled !== "function") {
  (Promise as any).allSettled = function <T>(promises: Iterable<T | PromiseLike<T>>) {
    const wrapped: Array<PromiseLike<any>> = [];
    for (const p of promises) {
      wrapped.push(
        Promise.resolve(p).then(
          (value) => ({ status: "fulfilled", value } as const),
          (reason) => ({ status: "rejected", reason } as const),
        ),
      );
    }
    return Promise.all(wrapped);
  };
}

if (typeof (Array.prototype as any).at !== "function") {
  Object.defineProperty(Array.prototype, "at", {
    value: function at<T>(this: T[], index: number): T | undefined {
      const len = this.length >>> 0;
      const n = Number(index);
      let k = n === n && isFinite(n) ? n : 0;
      k = k < 0 ? Math.ceil(k) : Math.floor(k);
      if (k < 0) k += len;
      if (k < 0 || k >= len) return undefined;
      return this[k];
    },
    writable: true,
    enumerable: false,
    configurable: true,
  });
}

function replaceChildrenPolyfill(this: ParentNode, ...nodes: Array<Node | string>) {
  while (this.firstChild) this.removeChild(this.firstChild);
  for (const node of nodes) {
    this.appendChild(typeof node === "string" ? document.createTextNode(node) : node);
  }
}

const replaceChildrenTargets: Array<any> = [
  typeof Document !== "undefined" ? Document.prototype : undefined,
  typeof DocumentFragment !== "undefined" ? DocumentFragment.prototype : undefined,
  typeof Element !== "undefined" ? Element.prototype : undefined,
].filter(Boolean);

for (const proto of replaceChildrenTargets) {
  if (typeof proto.replaceChildren !== "function") {
    Object.defineProperty(proto, "replaceChildren", {
      value: replaceChildrenPolyfill,
      writable: true,
      enumerable: false,
      configurable: true,
    });
  }
}
