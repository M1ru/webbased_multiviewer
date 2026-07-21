// Compatibility shims for older embedded Chromium (target baseline ~Chrome 80).
//
// esbuild down-levels new *syntax* at build time; this file back-fills missing
// *built-in methods* at runtime. It is intentionally dependency-free and
// worker-safe (no window/document), because it is also injected into the pdf.js
// Web Worker — where main-thread patches would not reach.
//
// Every patch is feature-detected: on an up-to-date engine nothing is replaced.

/* eslint-disable no-extend-native */
const g = typeof globalThis !== 'undefined' ? globalThis : self;

// globalThis (Chrome < 71)
if (typeof globalThis === 'undefined') {
  try {
    // eslint-disable-next-line no-global-assign
    self.globalThis = self;
  } catch {
    /* ignore */
  }
}

// ---- String / Array .at() (Chrome 92) ----
function at(n) {
  n = Math.trunc(n) || 0;
  if (n < 0) n += this.length;
  return n < 0 || n >= this.length ? undefined : this[n];
}
for (const C of [Array, String, typeof Int8Array !== 'undefined' ? Object.getPrototypeOf(Int8Array) : null]) {
  if (C && !C.prototype.at) def(C.prototype, 'at', at);
}

// ---- Array findLast / findLastIndex (Chrome 97) ----
if (!Array.prototype.findLast) {
  def(Array.prototype, 'findLast', function (pred, thisArg) {
    for (let i = this.length - 1; i >= 0; i--) if (pred.call(thisArg, this[i], i, this)) return this[i];
    return undefined;
  });
}
if (!Array.prototype.findLastIndex) {
  def(Array.prototype, 'findLastIndex', function (pred, thisArg) {
    for (let i = this.length - 1; i >= 0; i--) if (pred.call(thisArg, this[i], i, this)) return i;
    return -1;
  });
}

// ---- String.prototype.replaceAll (Chrome 85) ----
if (!String.prototype.replaceAll) {
  def(String.prototype, 'replaceAll', function (find, replace) {
    if (find instanceof RegExp) {
      if (!find.global) throw new TypeError('replaceAll must be called with a global RegExp');
      return this.replace(find, replace);
    }
    return this.split(String(find)).join(typeof replace === 'function' ? undefined : replace);
  });
}

// ---- Object.hasOwn (Chrome 93) ----
if (!Object.hasOwn) {
  def(Object, 'hasOwn', function (obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  });
}

// ---- Promise.allSettled (Chrome 76) / any (Chrome 85) ----
if (!Promise.allSettled) {
  def(Promise, 'allSettled', function (iter) {
    return Promise.all(
      Array.from(iter, (p) =>
        Promise.resolve(p).then(
          (value) => ({ status: 'fulfilled', value }),
          (reason) => ({ status: 'rejected', reason })
        )
      )
    );
  });
}
if (typeof AggregateError === 'undefined') {
  g.AggregateError = class AggregateError extends Error {
    constructor(errors, message) {
      super(message);
      this.name = 'AggregateError';
      this.errors = Array.from(errors);
    }
  };
}
if (!Promise.any) {
  def(Promise, 'any', function (iter) {
    const items = Array.from(iter);
    return new Promise((resolve, reject) => {
      let pending = items.length;
      const errors = new Array(pending);
      if (!pending) reject(new g.AggregateError([], 'All promises were rejected'));
      items.forEach((p, i) => {
        Promise.resolve(p).then(resolve, (e) => {
          errors[i] = e;
          if (--pending === 0) reject(new g.AggregateError(errors, 'All promises were rejected'));
        });
      });
    });
  });
}

// ---- Map / WeakMap upsert proposal: getOrInsert(Computed) (Chrome ~140) ----
// pdf.js v5 uses Map#getOrInsertComputed on both threads.
for (const C of [Map, typeof WeakMap !== 'undefined' ? WeakMap : null]) {
  if (!C) continue;
  if (!C.prototype.getOrInsert) {
    def(C.prototype, 'getOrInsert', function (key, defaultValue) {
      if (this.has(key)) return this.get(key);
      this.set(key, defaultValue);
      return defaultValue;
    });
  }
  if (!C.prototype.getOrInsertComputed) {
    def(C.prototype, 'getOrInsertComputed', function (key, callback) {
      if (this.has(key)) return this.get(key);
      const value = callback(key);
      this.set(key, value);
      return value;
    });
  }
}

// ---- structuredClone (Chrome 98) ----
if (typeof g.structuredClone !== 'function') {
  g.structuredClone = function structuredClone(value) {
    return deepClone(value, new Map());
  };
}
function deepClone(value, seen) {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);

  if (value instanceof Date) return new Date(value.getTime());
  if (value instanceof RegExp) return new RegExp(value.source, value.flags);
  if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) return value.slice(0);
  if (ArrayBuffer.isView(value)) {
    if (value instanceof DataView) return new DataView(value.buffer.slice(0), value.byteOffset, value.byteLength);
    return new value.constructor(value); // typed array copy
  }
  if (value instanceof Map) {
    const out = new Map();
    seen.set(value, out);
    value.forEach((v, k) => out.set(deepClone(k, seen), deepClone(v, seen)));
    return out;
  }
  if (value instanceof Set) {
    const out = new Set();
    seen.set(value, out);
    value.forEach((v) => out.add(deepClone(v, seen)));
    return out;
  }
  if (Array.isArray(value)) {
    const out = new Array(value.length);
    seen.set(value, out);
    for (let i = 0; i < value.length; i++) out[i] = deepClone(value[i], seen);
    return out;
  }
  const out = {};
  seen.set(value, out);
  for (const k of Object.keys(value)) out[k] = deepClone(value[k], seen);
  return out;
}

// ---- Uint8Array hex / base64 (TC39, Chrome ~140 / 2025) ----
// pdf.js v4 relies on these, including inside its worker.
const U8 = Uint8Array.prototype;
if (!U8.toHex) {
  const HEX = [];
  for (let i = 0; i < 256; i++) HEX[i] = i.toString(16).padStart(2, '0');
  def(U8, 'toHex', function () {
    let s = '';
    for (let i = 0; i < this.length; i++) s += HEX[this[i]];
    return s;
  });
}
if (!Uint8Array.fromHex) {
  def(Uint8Array, 'fromHex', function (str) {
    const clean = String(str);
    const out = new Uint8Array(clean.length >> 1);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
    return out;
  });
}
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
if (!U8.toBase64) {
  def(U8, 'toBase64', function (opts) {
    const alphabet = opts && opts.alphabet === 'base64url' ? B64.slice(0, 62) + '-_' : B64;
    let out = '';
    let i = 0;
    for (; i + 2 < this.length; i += 3) {
      const n = (this[i] << 16) | (this[i + 1] << 8) | this[i + 2];
      out += alphabet[(n >> 18) & 63] + alphabet[(n >> 12) & 63] + alphabet[(n >> 6) & 63] + alphabet[n & 63];
    }
    const rem = this.length - i;
    if (rem === 1) {
      const n = this[i] << 16;
      out += alphabet[(n >> 18) & 63] + alphabet[(n >> 12) & 63] + '==';
    } else if (rem === 2) {
      const n = (this[i] << 16) | (this[i + 1] << 8);
      out += alphabet[(n >> 18) & 63] + alphabet[(n >> 12) & 63] + alphabet[(n >> 6) & 63] + '=';
    }
    return out;
  });
}
if (!Uint8Array.fromBase64) {
  def(Uint8Array, 'fromBase64', function (str) {
    const bin = base64ToBinary(String(str));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  });
}
function base64ToBinary(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  if (typeof atob === 'function') return atob(s.replace(/[^A-Za-z0-9+/=]/g, ''));
  // Worker/Node without atob: manual decode.
  s = s.replace(/=+$/, '');
  let out = '';
  let buf = 0;
  let bits = 0;
  for (const ch of s) {
    const v = B64.indexOf(ch);
    if (v < 0) continue;
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((buf >> bits) & 0xff);
    }
  }
  return out;
}

function def(target, name, value) {
  try {
    Object.defineProperty(target, name, { value, writable: true, configurable: true, enumerable: false });
  } catch {
    try {
      target[name] = value;
    } catch {
      /* frozen — nothing we can do */
    }
  }
}
