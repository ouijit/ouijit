(function (g, f) {
    if ("object" == typeof exports && "object" == typeof module) {
      module.exports = f();
    } else if ("function" == typeof define && define.amd) {
      define("rrwebPlayer", [], f);
    } else if ("object" == typeof exports) {
      exports["rrwebPlayer"] = f();
    } else {
      g["rrwebPlayer"] = f();
    }
  }(this, () => {
var exports = {};
var module = { exports };
"use strict";
var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a2, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a2, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a2, prop, b[prop]);
    }
  return a2;
};
var __spreadProps = (a2, b) => __defProps(a2, __getOwnPropDescs(b));
var __objRest = (source, exclude) => {
  var target = {};
  for (var prop in source)
    if (__hasOwnProp.call(source, prop) && exclude.indexOf(prop) < 0)
      target[prop] = source[prop];
  if (source != null && __getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(source)) {
      if (exclude.indexOf(prop) < 0 && __propIsEnum.call(source, prop))
        target[prop] = source[prop];
    }
  return target;
};
var __defProp2 = Object.defineProperty;
var __defNormalProp2 = (obj, key, value) => key in obj ? __defProp2(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp2(obj, typeof key !== "symbol" ? key + "" : key, value);
Object.defineProperties(exports, { __esModule: { value: true }, [Symbol.toStringTag]: { value: "Module" } });
function noop() {
}
function assign(tar, src) {
  for (const k in src) tar[k] = src[k];
  return (
    /** @type {T & S} */
    tar
  );
}
function run(fn) {
  return fn();
}
function blank_object() {
  return /* @__PURE__ */ Object.create(null);
}
function run_all(fns) {
  fns.forEach(run);
}
function is_function(thing) {
  return typeof thing === "function";
}
function safe_not_equal(a2, b) {
  return a2 != a2 ? b == b : a2 !== b || a2 && typeof a2 === "object" || typeof a2 === "function";
}
function is_empty(obj) {
  return Object.keys(obj).length === 0;
}
function exclude_internal_props(props) {
  const result2 = {};
  for (const k in props) if (k[0] !== "$") result2[k] = props[k];
  return result2;
}
function append(target, node2) {
  target.appendChild(node2);
}
function insert(target, node2, anchor) {
  target.insertBefore(node2, anchor || null);
}
function detach(node2) {
  if (node2.parentNode) {
    node2.parentNode.removeChild(node2);
  }
}
function destroy_each(iterations, detaching) {
  for (let i = 0; i < iterations.length; i += 1) {
    if (iterations[i]) iterations[i].d(detaching);
  }
}
function element(name) {
  return document.createElement(name);
}
function svg_element(name) {
  return document.createElementNS("http://www.w3.org/2000/svg", name);
}
function text(data) {
  return document.createTextNode(data);
}
function space() {
  return text(" ");
}
function empty() {
  return text("");
}
function listen(node2, event, handler, options) {
  node2.addEventListener(event, handler, options);
  return () => node2.removeEventListener(event, handler, options);
}
function attr(node2, attribute, value) {
  if (value == null) node2.removeAttribute(attribute);
  else if (node2.getAttribute(attribute) !== value) node2.setAttribute(attribute, value);
}
function children(element2) {
  return Array.from(element2.childNodes);
}
function set_data(text2, data) {
  data = "" + data;
  if (text2.data === data) return;
  text2.data = /** @type {string} */
  data;
}
function set_style(node2, key, value, important) {
  if (value == null) {
    node2.style.removeProperty(key);
  } else {
    node2.style.setProperty(key, value, "");
  }
}
function toggle_class(element2, name, toggle) {
  element2.classList.toggle(name, !!toggle);
}
function custom_event(type, detail, { bubbles = false, cancelable = false } = {}) {
  return new CustomEvent(type, { detail, bubbles, cancelable });
}
let current_component;
function set_current_component(component) {
  current_component = component;
}
function get_current_component() {
  if (!current_component) throw new Error("Function called outside component initialization");
  return current_component;
}
function onMount(fn) {
  get_current_component().$$.on_mount.push(fn);
}
function afterUpdate(fn) {
  get_current_component().$$.after_update.push(fn);
}
function onDestroy(fn) {
  get_current_component().$$.on_destroy.push(fn);
}
function createEventDispatcher() {
  const component = get_current_component();
  return (type, detail, { cancelable = false } = {}) => {
    const callbacks = component.$$.callbacks[type];
    if (callbacks) {
      const event = custom_event(
        /** @type {string} */
        type,
        detail,
        { cancelable }
      );
      callbacks.slice().forEach((fn) => {
        fn.call(component, event);
      });
      return !event.defaultPrevented;
    }
    return true;
  };
}
const dirty_components = [];
const binding_callbacks = [];
let render_callbacks = [];
const flush_callbacks = [];
const resolved_promise = /* @__PURE__ */ Promise.resolve();
let update_scheduled = false;
function schedule_update() {
  if (!update_scheduled) {
    update_scheduled = true;
    resolved_promise.then(flush);
  }
}
function add_render_callback(fn) {
  render_callbacks.push(fn);
}
function add_flush_callback(fn) {
  flush_callbacks.push(fn);
}
const seen_callbacks = /* @__PURE__ */ new Set();
let flushidx = 0;
function flush() {
  if (flushidx !== 0) {
    return;
  }
  const saved_component = current_component;
  do {
    try {
      while (flushidx < dirty_components.length) {
        const component = dirty_components[flushidx];
        flushidx++;
        set_current_component(component);
        update(component.$$);
      }
    } catch (e2) {
      dirty_components.length = 0;
      flushidx = 0;
      throw e2;
    }
    set_current_component(null);
    dirty_components.length = 0;
    flushidx = 0;
    while (binding_callbacks.length) binding_callbacks.pop()();
    for (let i = 0; i < render_callbacks.length; i += 1) {
      const callback = render_callbacks[i];
      if (!seen_callbacks.has(callback)) {
        seen_callbacks.add(callback);
        callback();
      }
    }
    render_callbacks.length = 0;
  } while (dirty_components.length);
  while (flush_callbacks.length) {
    flush_callbacks.pop()();
  }
  update_scheduled = false;
  seen_callbacks.clear();
  set_current_component(saved_component);
}
function update($$) {
  if ($$.fragment !== null) {
    $$.update();
    run_all($$.before_update);
    const dirty = $$.dirty;
    $$.dirty = [-1];
    $$.fragment && $$.fragment.p($$.ctx, dirty);
    $$.after_update.forEach(add_render_callback);
  }
}
function flush_render_callbacks(fns) {
  const filtered = [];
  const targets = [];
  render_callbacks.forEach((c2) => fns.indexOf(c2) === -1 ? filtered.push(c2) : targets.push(c2));
  targets.forEach((c2) => c2());
  render_callbacks = filtered;
}
const outroing = /* @__PURE__ */ new Set();
let outros;
function group_outros() {
  outros = {
    r: 0,
    c: [],
    p: outros
    // parent group
  };
}
function check_outros() {
  if (!outros.r) {
    run_all(outros.c);
  }
  outros = outros.p;
}
function transition_in(block, local) {
  if (block && block.i) {
    outroing.delete(block);
    block.i(local);
  }
}
function transition_out(block, local, detach2, callback) {
  if (block && block.o) {
    if (outroing.has(block)) return;
    outroing.add(block);
    outros.c.push(() => {
      outroing.delete(block);
      if (callback) {
        if (detach2) block.d(1);
        callback();
      }
    });
    block.o(local);
  } else if (callback) {
    callback();
  }
}
function ensure_array_like(array_like_or_iterator) {
  return (array_like_or_iterator == null ? void 0 : array_like_or_iterator.length) !== void 0 ? array_like_or_iterator : Array.from(array_like_or_iterator);
}
function bind(component, name, callback) {
  const index2 = component.$$.props[name];
  if (index2 !== void 0) {
    component.$$.bound[index2] = callback;
    callback(component.$$.ctx[index2]);
  }
}
function create_component(block) {
  block && block.c();
}
function mount_component(component, target, anchor) {
  const { fragment, after_update } = component.$$;
  fragment && fragment.m(target, anchor);
  add_render_callback(() => {
    const new_on_destroy = component.$$.on_mount.map(run).filter(is_function);
    if (component.$$.on_destroy) {
      component.$$.on_destroy.push(...new_on_destroy);
    } else {
      run_all(new_on_destroy);
    }
    component.$$.on_mount = [];
  });
  after_update.forEach(add_render_callback);
}
function destroy_component(component, detaching) {
  const $$ = component.$$;
  if ($$.fragment !== null) {
    flush_render_callbacks($$.after_update);
    run_all($$.on_destroy);
    $$.fragment && $$.fragment.d(detaching);
    $$.on_destroy = $$.fragment = null;
    $$.ctx = [];
  }
}
function make_dirty(component, i) {
  if (component.$$.dirty[0] === -1) {
    dirty_components.push(component);
    schedule_update();
    component.$$.dirty.fill(0);
  }
  component.$$.dirty[i / 31 | 0] |= 1 << i % 31;
}
function init(component, options, instance2, create_fragment2, not_equal, props, append_styles = null, dirty = [-1]) {
  const parent_component = current_component;
  set_current_component(component);
  const $$ = component.$$ = {
    fragment: null,
    ctx: [],
    // state
    props,
    update: noop,
    not_equal,
    bound: blank_object(),
    // lifecycle
    on_mount: [],
    on_destroy: [],
    on_disconnect: [],
    before_update: [],
    after_update: [],
    context: new Map(options.context || (parent_component ? parent_component.$$.context : [])),
    // everything else
    callbacks: blank_object(),
    dirty,
    skip_bound: false,
    root: options.target || parent_component.$$.root
  };
  append_styles && append_styles($$.root);
  let ready = false;
  $$.ctx = instance2 ? instance2(component, options.props || {}, (i, ret, ...rest) => {
    const value = rest.length ? rest[0] : ret;
    if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
      if (!$$.skip_bound && $$.bound[i]) $$.bound[i](value);
      if (ready) make_dirty(component, i);
    }
    return ret;
  }) : [];
  $$.update();
  ready = true;
  run_all($$.before_update);
  $$.fragment = create_fragment2 ? create_fragment2($$.ctx) : false;
  if (options.target) {
    if (options.hydrate) {
      const nodes = children(options.target);
      $$.fragment && $$.fragment.l(nodes);
      nodes.forEach(detach);
    } else {
      $$.fragment && $$.fragment.c();
    }
    if (options.intro) transition_in(component.$$.fragment);
    mount_component(component, options.target, options.anchor);
    flush();
  }
  set_current_component(parent_component);
}
class SvelteComponent {
  constructor() {
    __publicField(this, "$$");
    __publicField(this, "$$set");
  }
  /** @returns {void} */
  $destroy() {
    destroy_component(this, 1);
    this.$destroy = noop;
  }
  /**
   * @template {Extract<keyof Events, string>} K
   * @param {K} type
   * @param {((e: Events[K]) => void) | null | undefined} callback
   * @returns {() => void}
   */
  $on(type, callback) {
    if (!is_function(callback)) {
      return noop;
    }
    const callbacks = this.$$.callbacks[type] || (this.$$.callbacks[type] = []);
    callbacks.push(callback);
    return () => {
      const index2 = callbacks.indexOf(callback);
      if (index2 !== -1) callbacks.splice(index2, 1);
    };
  }
  /**
   * @param {Partial<Props>} props
   * @returns {void}
   */
  $set(props) {
    if (this.$$set && !is_empty(props)) {
      this.$$.skip_bound = true;
      this.$$set(props);
      this.$$.skip_bound = false;
    }
  }
}
const PUBLIC_VERSION = "4";
if (typeof window !== "undefined")
  (window.__svelte || (window.__svelte = { v: /* @__PURE__ */ new Set() })).v.add(PUBLIC_VERSION);
var __defProp22 = Object.defineProperty;
var __defNormalProp22 = (obj, key, value) => key in obj ? __defProp22(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField2 = (obj, key, value) => __defNormalProp22(obj, typeof key !== "symbol" ? key + "" : key, value);
var _a$1;
var __defProp$1 = Object.defineProperty;
var __defNormalProp$1 = (obj, key, value) => key in obj ? __defProp$1(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField$1 = (obj, key, value) => __defNormalProp$1(obj, typeof key !== "symbol" ? key + "" : key, value);
var NodeType$3 = /* @__PURE__ */ ((NodeType2) => {
  NodeType2[NodeType2["Document"] = 0] = "Document";
  NodeType2[NodeType2["DocumentType"] = 1] = "DocumentType";
  NodeType2[NodeType2["Element"] = 2] = "Element";
  NodeType2[NodeType2["Text"] = 3] = "Text";
  NodeType2[NodeType2["CDATA"] = 4] = "CDATA";
  NodeType2[NodeType2["Comment"] = 5] = "Comment";
  return NodeType2;
})(NodeType$3 || {});
function isElement(n2) {
  return n2.nodeType === n2.ELEMENT_NODE;
}
class Mirror {
  constructor() {
    __publicField$1(this, "idNodeMap", /* @__PURE__ */ new Map());
    __publicField$1(this, "nodeMetaMap", /* @__PURE__ */ new WeakMap());
  }
  getId(n2) {
    var _a2;
    if (!n2) return -1;
    const id = (_a2 = this.getMeta(n2)) == null ? void 0 : _a2.id;
    return id != null ? id : -1;
  }
  getNode(id) {
    return this.idNodeMap.get(id) || null;
  }
  getIds() {
    return Array.from(this.idNodeMap.keys());
  }
  getMeta(n2) {
    return this.nodeMetaMap.get(n2) || null;
  }
  // removes the node from idNodeMap
  // doesn't remove the node from nodeMetaMap
  removeNodeFromMap(n2) {
    const id = this.getId(n2);
    this.idNodeMap.delete(id);
    if (n2.childNodes) {
      n2.childNodes.forEach(
        (childNode) => this.removeNodeFromMap(childNode)
      );
    }
  }
  has(id) {
    return this.idNodeMap.has(id);
  }
  hasNode(node2) {
    return this.nodeMetaMap.has(node2);
  }
  add(n2, meta) {
    const id = meta.id;
    this.idNodeMap.set(id, n2);
    this.nodeMetaMap.set(n2, meta);
  }
  replace(id, n2) {
    const oldNode = this.getNode(id);
    if (oldNode) {
      const meta = this.nodeMetaMap.get(oldNode);
      if (meta) this.nodeMetaMap.set(n2, meta);
    }
    this.idNodeMap.set(id, n2);
  }
  reset() {
    this.idNodeMap = /* @__PURE__ */ new Map();
    this.nodeMetaMap = /* @__PURE__ */ new WeakMap();
  }
}
function createMirror$2() {
  return new Mirror();
}
function toLowerCase(str) {
  return str.toLowerCase();
}
function isNodeMetaEqual(a2, b) {
  if (!a2 || !b || a2.type !== b.type) return false;
  if (a2.type === NodeType$3.Document)
    return a2.compatMode === b.compatMode;
  else if (a2.type === NodeType$3.DocumentType)
    return a2.name === b.name && a2.publicId === b.publicId && a2.systemId === b.systemId;
  else if (a2.type === NodeType$3.Comment || a2.type === NodeType$3.Text || a2.type === NodeType$3.CDATA)
    return a2.textContent === b.textContent;
  else if (a2.type === NodeType$3.Element)
    return a2.tagName === b.tagName && JSON.stringify(a2.attributes) === JSON.stringify(b.attributes) && a2.isSVG === b.isSVG && a2.needBlock === b.needBlock;
  return false;
}
function extractFileExtension(path, baseURL) {
  var _a2;
  let url;
  try {
    url = new URL(path, baseURL != null ? baseURL : window.location.href);
  } catch (err) {
    return null;
  }
  const regex = /\.([0-9a-z]+)(?:$)/i;
  const match = url.pathname.match(regex);
  return (_a2 = match == null ? void 0 : match[1]) != null ? _a2 : null;
}
const MEDIA_SELECTOR = /(max|min)-device-(width|height)/;
const MEDIA_SELECTOR_GLOBAL = new RegExp(MEDIA_SELECTOR.source, "g");
const mediaSelectorPlugin = {
  postcssPlugin: "postcss-custom-selectors",
  prepare() {
    return {
      postcssPlugin: "postcss-custom-selectors",
      AtRule: function(atrule) {
        if (atrule.params.match(MEDIA_SELECTOR_GLOBAL)) {
          atrule.params = atrule.params.replace(MEDIA_SELECTOR_GLOBAL, "$1-$2");
        }
      }
    };
  }
};
const pseudoClassPlugin = {
  postcssPlugin: "postcss-hover-classes",
  prepare: function() {
    const fixed = [];
    return {
      Rule: function(rule2) {
        if (fixed.indexOf(rule2) !== -1) {
          return;
        }
        fixed.push(rule2);
        rule2.selectors.forEach(function(selector) {
          if (selector.includes(":hover")) {
            rule2.selector += ",\n" + selector.replace(/:hover/g, ".\\:hover");
          }
        });
      }
    };
  }
};
function getDefaultExportFromCjs$1(x2) {
  return x2 && x2.__esModule && Object.prototype.hasOwnProperty.call(x2, "default") ? x2["default"] : x2;
}
function getAugmentedNamespace$1(n2) {
  if (n2.__esModule) return n2;
  var f2 = n2.default;
  if (typeof f2 == "function") {
    var a2 = function a22() {
      if (this instanceof a22) {
        return Reflect.construct(f2, arguments, this.constructor);
      }
      return f2.apply(this, arguments);
    };
    a2.prototype = f2.prototype;
  } else a2 = {};
  Object.defineProperty(a2, "__esModule", { value: true });
  Object.keys(n2).forEach(function(k) {
    var d = Object.getOwnPropertyDescriptor(n2, k);
    Object.defineProperty(a2, k, d.get ? d : {
      enumerable: true,
      get: function() {
        return n2[k];
      }
    });
  });
  return a2;
}
var picocolors_browser$1 = { exports: {} };
var x$1 = String;
var create$1 = function() {
  return { isColorSupported: false, reset: x$1, bold: x$1, dim: x$1, italic: x$1, underline: x$1, inverse: x$1, hidden: x$1, strikethrough: x$1, black: x$1, red: x$1, green: x$1, yellow: x$1, blue: x$1, magenta: x$1, cyan: x$1, white: x$1, gray: x$1, bgBlack: x$1, bgRed: x$1, bgGreen: x$1, bgYellow: x$1, bgBlue: x$1, bgMagenta: x$1, bgCyan: x$1, bgWhite: x$1 };
};
picocolors_browser$1.exports = create$1();
picocolors_browser$1.exports.createColors = create$1;
var picocolors_browserExports$1 = picocolors_browser$1.exports;
const __viteBrowserExternal$2 = {};
const __viteBrowserExternal$1$1 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: __viteBrowserExternal$2
}, Symbol.toStringTag, { value: "Module" }));
const require$$2$1 = /* @__PURE__ */ getAugmentedNamespace$1(__viteBrowserExternal$1$1);
let pico$1 = picocolors_browserExports$1;
let terminalHighlight$1$1 = require$$2$1;
let CssSyntaxError$3$1 = class CssSyntaxError extends Error {
  constructor(message, line, column, source, file, plugin22) {
    super(message);
    this.name = "CssSyntaxError";
    this.reason = message;
    if (file) {
      this.file = file;
    }
    if (source) {
      this.source = source;
    }
    if (plugin22) {
      this.plugin = plugin22;
    }
    if (typeof line !== "undefined" && typeof column !== "undefined") {
      if (typeof line === "number") {
        this.line = line;
        this.column = column;
      } else {
        this.line = line.line;
        this.column = line.column;
        this.endLine = column.line;
        this.endColumn = column.column;
      }
    }
    this.setMessage();
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, CssSyntaxError);
    }
  }
  setMessage() {
    this.message = this.plugin ? this.plugin + ": " : "";
    this.message += this.file ? this.file : "<css input>";
    if (typeof this.line !== "undefined") {
      this.message += ":" + this.line + ":" + this.column;
    }
    this.message += ": " + this.reason;
  }
  showSourceCode(color) {
    if (!this.source) return "";
    let css = this.source;
    if (color == null) color = pico$1.isColorSupported;
    if (terminalHighlight$1$1) {
      if (color) css = terminalHighlight$1$1(css);
    }
    let lines = css.split(/\r?\n/);
    let start = Math.max(this.line - 3, 0);
    let end = Math.min(this.line + 2, lines.length);
    let maxWidth = String(end).length;
    let mark, aside;
    if (color) {
      let { bold, gray, red } = pico$1.createColors(true);
      mark = (text2) => bold(red(text2));
      aside = (text2) => gray(text2);
    } else {
      mark = aside = (str) => str;
    }
    return lines.slice(start, end).map((line, index2) => {
      let number = start + 1 + index2;
      let gutter = " " + (" " + number).slice(-maxWidth) + " | ";
      if (number === this.line) {
        let spacing = aside(gutter.replace(/\d/g, " ")) + line.slice(0, this.column - 1).replace(/[^\t]/g, " ");
        return mark(">") + aside(gutter) + line + "\n " + spacing + mark("^");
      }
      return " " + aside(gutter) + line;
    }).join("\n");
  }
  toString() {
    let code = this.showSourceCode();
    if (code) {
      code = "\n\n" + code + "\n";
    }
    return this.name + ": " + this.message + code;
  }
};
var cssSyntaxError$1 = CssSyntaxError$3$1;
CssSyntaxError$3$1.default = CssSyntaxError$3$1;
var symbols$1 = {};
symbols$1.isClean = Symbol("isClean");
symbols$1.my = Symbol("my");
const DEFAULT_RAW$1 = {
  after: "\n",
  beforeClose: "\n",
  beforeComment: "\n",
  beforeDecl: "\n",
  beforeOpen: " ",
  beforeRule: "\n",
  colon: ": ",
  commentLeft: " ",
  commentRight: " ",
  emptyBody: "",
  indent: "    ",
  semicolon: false
};
function capitalize$1(str) {
  return str[0].toUpperCase() + str.slice(1);
}
let Stringifier$2$1 = class Stringifier {
  constructor(builder) {
    this.builder = builder;
  }
  atrule(node2, semicolon) {
    let name = "@" + node2.name;
    let params = node2.params ? this.rawValue(node2, "params") : "";
    if (typeof node2.raws.afterName !== "undefined") {
      name += node2.raws.afterName;
    } else if (params) {
      name += " ";
    }
    if (node2.nodes) {
      this.block(node2, name + params);
    } else {
      let end = (node2.raws.between || "") + (semicolon ? ";" : "");
      this.builder(name + params + end, node2);
    }
  }
  beforeAfter(node2, detect) {
    let value;
    if (node2.type === "decl") {
      value = this.raw(node2, null, "beforeDecl");
    } else if (node2.type === "comment") {
      value = this.raw(node2, null, "beforeComment");
    } else if (detect === "before") {
      value = this.raw(node2, null, "beforeRule");
    } else {
      value = this.raw(node2, null, "beforeClose");
    }
    let buf = node2.parent;
    let depth = 0;
    while (buf && buf.type !== "root") {
      depth += 1;
      buf = buf.parent;
    }
    if (value.includes("\n")) {
      let indent = this.raw(node2, null, "indent");
      if (indent.length) {
        for (let step = 0; step < depth; step++) value += indent;
      }
    }
    return value;
  }
  block(node2, start) {
    let between = this.raw(node2, "between", "beforeOpen");
    this.builder(start + between + "{", node2, "start");
    let after;
    if (node2.nodes && node2.nodes.length) {
      this.body(node2);
      after = this.raw(node2, "after");
    } else {
      after = this.raw(node2, "after", "emptyBody");
    }
    if (after) this.builder(after);
    this.builder("}", node2, "end");
  }
  body(node2) {
    let last = node2.nodes.length - 1;
    while (last > 0) {
      if (node2.nodes[last].type !== "comment") break;
      last -= 1;
    }
    let semicolon = this.raw(node2, "semicolon");
    for (let i2 = 0; i2 < node2.nodes.length; i2++) {
      let child = node2.nodes[i2];
      let before = this.raw(child, "before");
      if (before) this.builder(before);
      this.stringify(child, last !== i2 || semicolon);
    }
  }
  comment(node2) {
    let left = this.raw(node2, "left", "commentLeft");
    let right = this.raw(node2, "right", "commentRight");
    this.builder("/*" + left + node2.text + right + "*/", node2);
  }
  decl(node2, semicolon) {
    let between = this.raw(node2, "between", "colon");
    let string = node2.prop + between + this.rawValue(node2, "value");
    if (node2.important) {
      string += node2.raws.important || " !important";
    }
    if (semicolon) string += ";";
    this.builder(string, node2);
  }
  document(node2) {
    this.body(node2);
  }
  raw(node2, own, detect) {
    let value;
    if (!detect) detect = own;
    if (own) {
      value = node2.raws[own];
      if (typeof value !== "undefined") return value;
    }
    let parent = node2.parent;
    if (detect === "before") {
      if (!parent || parent.type === "root" && parent.first === node2) {
        return "";
      }
      if (parent && parent.type === "document") {
        return "";
      }
    }
    if (!parent) return DEFAULT_RAW$1[detect];
    let root2 = node2.root();
    if (!root2.rawCache) root2.rawCache = {};
    if (typeof root2.rawCache[detect] !== "undefined") {
      return root2.rawCache[detect];
    }
    if (detect === "before" || detect === "after") {
      return this.beforeAfter(node2, detect);
    } else {
      let method = "raw" + capitalize$1(detect);
      if (this[method]) {
        value = this[method](root2, node2);
      } else {
        root2.walk((i2) => {
          value = i2.raws[own];
          if (typeof value !== "undefined") return false;
        });
      }
    }
    if (typeof value === "undefined") value = DEFAULT_RAW$1[detect];
    root2.rawCache[detect] = value;
    return value;
  }
  rawBeforeClose(root2) {
    let value;
    root2.walk((i2) => {
      if (i2.nodes && i2.nodes.length > 0) {
        if (typeof i2.raws.after !== "undefined") {
          value = i2.raws.after;
          if (value.includes("\n")) {
            value = value.replace(/[^\n]+$/, "");
          }
          return false;
        }
      }
    });
    if (value) value = value.replace(/\S/g, "");
    return value;
  }
  rawBeforeComment(root2, node2) {
    let value;
    root2.walkComments((i2) => {
      if (typeof i2.raws.before !== "undefined") {
        value = i2.raws.before;
        if (value.includes("\n")) {
          value = value.replace(/[^\n]+$/, "");
        }
        return false;
      }
    });
    if (typeof value === "undefined") {
      value = this.raw(node2, null, "beforeDecl");
    } else if (value) {
      value = value.replace(/\S/g, "");
    }
    return value;
  }
  rawBeforeDecl(root2, node2) {
    let value;
    root2.walkDecls((i2) => {
      if (typeof i2.raws.before !== "undefined") {
        value = i2.raws.before;
        if (value.includes("\n")) {
          value = value.replace(/[^\n]+$/, "");
        }
        return false;
      }
    });
    if (typeof value === "undefined") {
      value = this.raw(node2, null, "beforeRule");
    } else if (value) {
      value = value.replace(/\S/g, "");
    }
    return value;
  }
  rawBeforeOpen(root2) {
    let value;
    root2.walk((i2) => {
      if (i2.type !== "decl") {
        value = i2.raws.between;
        if (typeof value !== "undefined") return false;
      }
    });
    return value;
  }
  rawBeforeRule(root2) {
    let value;
    root2.walk((i2) => {
      if (i2.nodes && (i2.parent !== root2 || root2.first !== i2)) {
        if (typeof i2.raws.before !== "undefined") {
          value = i2.raws.before;
          if (value.includes("\n")) {
            value = value.replace(/[^\n]+$/, "");
          }
          return false;
        }
      }
    });
    if (value) value = value.replace(/\S/g, "");
    return value;
  }
  rawColon(root2) {
    let value;
    root2.walkDecls((i2) => {
      if (typeof i2.raws.between !== "undefined") {
        value = i2.raws.between.replace(/[^\s:]/g, "");
        return false;
      }
    });
    return value;
  }
  rawEmptyBody(root2) {
    let value;
    root2.walk((i2) => {
      if (i2.nodes && i2.nodes.length === 0) {
        value = i2.raws.after;
        if (typeof value !== "undefined") return false;
      }
    });
    return value;
  }
  rawIndent(root2) {
    if (root2.raws.indent) return root2.raws.indent;
    let value;
    root2.walk((i2) => {
      let p = i2.parent;
      if (p && p !== root2 && p.parent && p.parent === root2) {
        if (typeof i2.raws.before !== "undefined") {
          let parts = i2.raws.before.split("\n");
          value = parts[parts.length - 1];
          value = value.replace(/\S/g, "");
          return false;
        }
      }
    });
    return value;
  }
  rawSemicolon(root2) {
    let value;
    root2.walk((i2) => {
      if (i2.nodes && i2.nodes.length && i2.last.type === "decl") {
        value = i2.raws.semicolon;
        if (typeof value !== "undefined") return false;
      }
    });
    return value;
  }
  rawValue(node2, prop) {
    let value = node2[prop];
    let raw = node2.raws[prop];
    if (raw && raw.value === value) {
      return raw.raw;
    }
    return value;
  }
  root(node2) {
    this.body(node2);
    if (node2.raws.after) this.builder(node2.raws.after);
  }
  rule(node2) {
    this.block(node2, this.rawValue(node2, "selector"));
    if (node2.raws.ownSemicolon) {
      this.builder(node2.raws.ownSemicolon, node2, "end");
    }
  }
  stringify(node2, semicolon) {
    if (!this[node2.type]) {
      throw new Error(
        "Unknown AST node type " + node2.type + ". Maybe you need to change PostCSS stringifier."
      );
    }
    this[node2.type](node2, semicolon);
  }
};
var stringifier$1 = Stringifier$2$1;
Stringifier$2$1.default = Stringifier$2$1;
let Stringifier$1$1 = stringifier$1;
function stringify$4$1(node2, builder) {
  let str = new Stringifier$1$1(builder);
  str.stringify(node2);
}
var stringify_1$1 = stringify$4$1;
stringify$4$1.default = stringify$4$1;
let { isClean: isClean$2$1, my: my$2$1 } = symbols$1;
let CssSyntaxError$2$1 = cssSyntaxError$1;
let Stringifier2$1 = stringifier$1;
let stringify$3$1 = stringify_1$1;
function cloneNode$1(obj, parent) {
  let cloned = new obj.constructor();
  for (let i2 in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, i2)) {
      continue;
    }
    if (i2 === "proxyCache") continue;
    let value = obj[i2];
    let type = typeof value;
    if (i2 === "parent" && type === "object") {
      if (parent) cloned[i2] = parent;
    } else if (i2 === "source") {
      cloned[i2] = value;
    } else if (Array.isArray(value)) {
      cloned[i2] = value.map((j) => cloneNode$1(j, cloned));
    } else {
      if (type === "object" && value !== null) value = cloneNode$1(value);
      cloned[i2] = value;
    }
  }
  return cloned;
}
let Node$4$1 = class Node2 {
  constructor(defaults = {}) {
    this.raws = {};
    this[isClean$2$1] = false;
    this[my$2$1] = true;
    for (let name in defaults) {
      if (name === "nodes") {
        this.nodes = [];
        for (let node2 of defaults[name]) {
          if (typeof node2.clone === "function") {
            this.append(node2.clone());
          } else {
            this.append(node2);
          }
        }
      } else {
        this[name] = defaults[name];
      }
    }
  }
  addToError(error) {
    error.postcssNode = this;
    if (error.stack && this.source && /\n\s{4}at /.test(error.stack)) {
      let s2 = this.source;
      error.stack = error.stack.replace(
        /\n\s{4}at /,
        `$&${s2.input.from}:${s2.start.line}:${s2.start.column}$&`
      );
    }
    return error;
  }
  after(add) {
    this.parent.insertAfter(this, add);
    return this;
  }
  assign(overrides = {}) {
    for (let name in overrides) {
      this[name] = overrides[name];
    }
    return this;
  }
  before(add) {
    this.parent.insertBefore(this, add);
    return this;
  }
  cleanRaws(keepBetween) {
    delete this.raws.before;
    delete this.raws.after;
    if (!keepBetween) delete this.raws.between;
  }
  clone(overrides = {}) {
    let cloned = cloneNode$1(this);
    for (let name in overrides) {
      cloned[name] = overrides[name];
    }
    return cloned;
  }
  cloneAfter(overrides = {}) {
    let cloned = this.clone(overrides);
    this.parent.insertAfter(this, cloned);
    return cloned;
  }
  cloneBefore(overrides = {}) {
    let cloned = this.clone(overrides);
    this.parent.insertBefore(this, cloned);
    return cloned;
  }
  error(message, opts = {}) {
    if (this.source) {
      let { end, start } = this.rangeBy(opts);
      return this.source.input.error(
        message,
        { column: start.column, line: start.line },
        { column: end.column, line: end.line },
        opts
      );
    }
    return new CssSyntaxError$2$1(message);
  }
  getProxyProcessor() {
    return {
      get(node2, prop) {
        if (prop === "proxyOf") {
          return node2;
        } else if (prop === "root") {
          return () => node2.root().toProxy();
        } else {
          return node2[prop];
        }
      },
      set(node2, prop, value) {
        if (node2[prop] === value) return true;
        node2[prop] = value;
        if (prop === "prop" || prop === "value" || prop === "name" || prop === "params" || prop === "important" || /* c8 ignore next */
        prop === "text") {
          node2.markDirty();
        }
        return true;
      }
    };
  }
  markDirty() {
    if (this[isClean$2$1]) {
      this[isClean$2$1] = false;
      let next = this;
      while (next = next.parent) {
        next[isClean$2$1] = false;
      }
    }
  }
  next() {
    if (!this.parent) return void 0;
    let index2 = this.parent.index(this);
    return this.parent.nodes[index2 + 1];
  }
  positionBy(opts, stringRepresentation) {
    let pos = this.source.start;
    if (opts.index) {
      pos = this.positionInside(opts.index, stringRepresentation);
    } else if (opts.word) {
      stringRepresentation = this.toString();
      let index2 = stringRepresentation.indexOf(opts.word);
      if (index2 !== -1) pos = this.positionInside(index2, stringRepresentation);
    }
    return pos;
  }
  positionInside(index2, stringRepresentation) {
    let string = stringRepresentation || this.toString();
    let column = this.source.start.column;
    let line = this.source.start.line;
    for (let i2 = 0; i2 < index2; i2++) {
      if (string[i2] === "\n") {
        column = 1;
        line += 1;
      } else {
        column += 1;
      }
    }
    return { column, line };
  }
  prev() {
    if (!this.parent) return void 0;
    let index2 = this.parent.index(this);
    return this.parent.nodes[index2 - 1];
  }
  rangeBy(opts) {
    let start = {
      column: this.source.start.column,
      line: this.source.start.line
    };
    let end = this.source.end ? {
      column: this.source.end.column + 1,
      line: this.source.end.line
    } : {
      column: start.column + 1,
      line: start.line
    };
    if (opts.word) {
      let stringRepresentation = this.toString();
      let index2 = stringRepresentation.indexOf(opts.word);
      if (index2 !== -1) {
        start = this.positionInside(index2, stringRepresentation);
        end = this.positionInside(index2 + opts.word.length, stringRepresentation);
      }
    } else {
      if (opts.start) {
        start = {
          column: opts.start.column,
          line: opts.start.line
        };
      } else if (opts.index) {
        start = this.positionInside(opts.index);
      }
      if (opts.end) {
        end = {
          column: opts.end.column,
          line: opts.end.line
        };
      } else if (typeof opts.endIndex === "number") {
        end = this.positionInside(opts.endIndex);
      } else if (opts.index) {
        end = this.positionInside(opts.index + 1);
      }
    }
    if (end.line < start.line || end.line === start.line && end.column <= start.column) {
      end = { column: start.column + 1, line: start.line };
    }
    return { end, start };
  }
  raw(prop, defaultType) {
    let str = new Stringifier2$1();
    return str.raw(this, prop, defaultType);
  }
  remove() {
    if (this.parent) {
      this.parent.removeChild(this);
    }
    this.parent = void 0;
    return this;
  }
  replaceWith(...nodes) {
    if (this.parent) {
      let bookmark = this;
      let foundSelf = false;
      for (let node2 of nodes) {
        if (node2 === this) {
          foundSelf = true;
        } else if (foundSelf) {
          this.parent.insertAfter(bookmark, node2);
          bookmark = node2;
        } else {
          this.parent.insertBefore(bookmark, node2);
        }
      }
      if (!foundSelf) {
        this.remove();
      }
    }
    return this;
  }
  root() {
    let result2 = this;
    while (result2.parent && result2.parent.type !== "document") {
      result2 = result2.parent;
    }
    return result2;
  }
  toJSON(_, inputs) {
    let fixed = {};
    let emitInputs = inputs == null;
    inputs = inputs || /* @__PURE__ */ new Map();
    let inputsNextIndex = 0;
    for (let name in this) {
      if (!Object.prototype.hasOwnProperty.call(this, name)) {
        continue;
      }
      if (name === "parent" || name === "proxyCache") continue;
      let value = this[name];
      if (Array.isArray(value)) {
        fixed[name] = value.map((i2) => {
          if (typeof i2 === "object" && i2.toJSON) {
            return i2.toJSON(null, inputs);
          } else {
            return i2;
          }
        });
      } else if (typeof value === "object" && value.toJSON) {
        fixed[name] = value.toJSON(null, inputs);
      } else if (name === "source") {
        let inputId = inputs.get(value.input);
        if (inputId == null) {
          inputId = inputsNextIndex;
          inputs.set(value.input, inputsNextIndex);
          inputsNextIndex++;
        }
        fixed[name] = {
          end: value.end,
          inputId,
          start: value.start
        };
      } else {
        fixed[name] = value;
      }
    }
    if (emitInputs) {
      fixed.inputs = [...inputs.keys()].map((input2) => input2.toJSON());
    }
    return fixed;
  }
  toProxy() {
    if (!this.proxyCache) {
      this.proxyCache = new Proxy(this, this.getProxyProcessor());
    }
    return this.proxyCache;
  }
  toString(stringifier2 = stringify$3$1) {
    if (stringifier2.stringify) stringifier2 = stringifier2.stringify;
    let result2 = "";
    stringifier2(this, (i2) => {
      result2 += i2;
    });
    return result2;
  }
  warn(result2, text2, opts) {
    let data = { node: this };
    for (let i2 in opts) data[i2] = opts[i2];
    return result2.warn(text2, data);
  }
  get proxyOf() {
    return this;
  }
};
var node$1 = Node$4$1;
Node$4$1.default = Node$4$1;
let Node$3$1 = node$1;
let Declaration$4$1 = class Declaration extends Node$3$1 {
  constructor(defaults) {
    if (defaults && typeof defaults.value !== "undefined" && typeof defaults.value !== "string") {
      defaults = __spreadProps(__spreadValues({}, defaults), { value: String(defaults.value) });
    }
    super(defaults);
    this.type = "decl";
  }
  get variable() {
    return this.prop.startsWith("--") || this.prop[0] === "$";
  }
};
var declaration$1 = Declaration$4$1;
Declaration$4$1.default = Declaration$4$1;
let urlAlphabet$1 = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";
let customAlphabet$1 = (alphabet, defaultSize = 21) => {
  return (size = defaultSize) => {
    let id = "";
    let i2 = size;
    while (i2--) {
      id += alphabet[Math.random() * alphabet.length | 0];
    }
    return id;
  };
};
let nanoid$1$1 = (size = 21) => {
  let id = "";
  let i2 = size;
  while (i2--) {
    id += urlAlphabet$1[Math.random() * 64 | 0];
  }
  return id;
};
var nonSecure$1 = { nanoid: nanoid$1$1, customAlphabet: customAlphabet$1 };
let { SourceMapConsumer: SourceMapConsumer$2$1, SourceMapGenerator: SourceMapGenerator$2$1 } = require$$2$1;
let { existsSync: existsSync$1, readFileSync: readFileSync$1 } = require$$2$1;
let { dirname: dirname$1$1, join: join$1 } = require$$2$1;
function fromBase64$1(str) {
  if (Buffer) {
    return Buffer.from(str, "base64").toString();
  } else {
    return window.atob(str);
  }
}
let PreviousMap$2$1 = class PreviousMap {
  constructor(css, opts) {
    if (opts.map === false) return;
    this.loadAnnotation(css);
    this.inline = this.startWith(this.annotation, "data:");
    let prev = opts.map ? opts.map.prev : void 0;
    let text2 = this.loadMap(opts.from, prev);
    if (!this.mapFile && opts.from) {
      this.mapFile = opts.from;
    }
    if (this.mapFile) this.root = dirname$1$1(this.mapFile);
    if (text2) this.text = text2;
  }
  consumer() {
    if (!this.consumerCache) {
      this.consumerCache = new SourceMapConsumer$2$1(this.text);
    }
    return this.consumerCache;
  }
  decodeInline(text2) {
    let baseCharsetUri = /^data:application\/json;charset=utf-?8;base64,/;
    let baseUri = /^data:application\/json;base64,/;
    let charsetUri = /^data:application\/json;charset=utf-?8,/;
    let uri = /^data:application\/json,/;
    if (charsetUri.test(text2) || uri.test(text2)) {
      return decodeURIComponent(text2.substr(RegExp.lastMatch.length));
    }
    if (baseCharsetUri.test(text2) || baseUri.test(text2)) {
      return fromBase64$1(text2.substr(RegExp.lastMatch.length));
    }
    let encoding = text2.match(/data:application\/json;([^,]+),/)[1];
    throw new Error("Unsupported source map encoding " + encoding);
  }
  getAnnotationURL(sourceMapString) {
    return sourceMapString.replace(/^\/\*\s*# sourceMappingURL=/, "").trim();
  }
  isMap(map) {
    if (typeof map !== "object") return false;
    return typeof map.mappings === "string" || typeof map._mappings === "string" || Array.isArray(map.sections);
  }
  loadAnnotation(css) {
    let comments = css.match(/\/\*\s*# sourceMappingURL=/gm);
    if (!comments) return;
    let start = css.lastIndexOf(comments.pop());
    let end = css.indexOf("*/", start);
    if (start > -1 && end > -1) {
      this.annotation = this.getAnnotationURL(css.substring(start, end));
    }
  }
  loadFile(path) {
    this.root = dirname$1$1(path);
    if (existsSync$1(path)) {
      this.mapFile = path;
      return readFileSync$1(path, "utf-8").toString().trim();
    }
  }
  loadMap(file, prev) {
    if (prev === false) return false;
    if (prev) {
      if (typeof prev === "string") {
        return prev;
      } else if (typeof prev === "function") {
        let prevPath = prev(file);
        if (prevPath) {
          let map = this.loadFile(prevPath);
          if (!map) {
            throw new Error(
              "Unable to load previous source map: " + prevPath.toString()
            );
          }
          return map;
        }
      } else if (prev instanceof SourceMapConsumer$2$1) {
        return SourceMapGenerator$2$1.fromSourceMap(prev).toString();
      } else if (prev instanceof SourceMapGenerator$2$1) {
        return prev.toString();
      } else if (this.isMap(prev)) {
        return JSON.stringify(prev);
      } else {
        throw new Error(
          "Unsupported previous source map format: " + prev.toString()
        );
      }
    } else if (this.inline) {
      return this.decodeInline(this.annotation);
    } else if (this.annotation) {
      let map = this.annotation;
      if (file) map = join$1(dirname$1$1(file), map);
      return this.loadFile(map);
    }
  }
  startWith(string, start) {
    if (!string) return false;
    return string.substr(0, start.length) === start;
  }
  withContent() {
    return !!(this.consumer().sourcesContent && this.consumer().sourcesContent.length > 0);
  }
};
var previousMap$1 = PreviousMap$2$1;
PreviousMap$2$1.default = PreviousMap$2$1;
let { SourceMapConsumer: SourceMapConsumer$1$1, SourceMapGenerator: SourceMapGenerator$1$1 } = require$$2$1;
let { fileURLToPath: fileURLToPath$1, pathToFileURL: pathToFileURL$1$1 } = require$$2$1;
let { isAbsolute: isAbsolute$1, resolve: resolve$1$1 } = require$$2$1;
let { nanoid: nanoid$2 } = nonSecure$1;
let terminalHighlight$2 = require$$2$1;
let CssSyntaxError$1$1 = cssSyntaxError$1;
let PreviousMap$1$1 = previousMap$1;
let fromOffsetCache$1 = Symbol("fromOffsetCache");
let sourceMapAvailable$1$1 = Boolean(SourceMapConsumer$1$1 && SourceMapGenerator$1$1);
let pathAvailable$1$1 = Boolean(resolve$1$1 && isAbsolute$1);
let Input$4$1 = class Input {
  constructor(css, opts = {}) {
    if (css === null || typeof css === "undefined" || typeof css === "object" && !css.toString) {
      throw new Error(`PostCSS received ${css} instead of CSS string`);
    }
    this.css = css.toString();
    if (this.css[0] === "\uFEFF" || this.css[0] === "\uFFFE") {
      this.hasBOM = true;
      this.css = this.css.slice(1);
    } else {
      this.hasBOM = false;
    }
    if (opts.from) {
      if (!pathAvailable$1$1 || /^\w+:\/\//.test(opts.from) || isAbsolute$1(opts.from)) {
        this.file = opts.from;
      } else {
        this.file = resolve$1$1(opts.from);
      }
    }
    if (pathAvailable$1$1 && sourceMapAvailable$1$1) {
      let map = new PreviousMap$1$1(this.css, opts);
      if (map.text) {
        this.map = map;
        let file = map.consumer().file;
        if (!this.file && file) this.file = this.mapResolve(file);
      }
    }
    if (!this.file) {
      this.id = "<input css " + nanoid$2(6) + ">";
    }
    if (this.map) this.map.file = this.from;
  }
  error(message, line, column, opts = {}) {
    let result2, endLine, endColumn;
    if (line && typeof line === "object") {
      let start = line;
      let end = column;
      if (typeof start.offset === "number") {
        let pos = this.fromOffset(start.offset);
        line = pos.line;
        column = pos.col;
      } else {
        line = start.line;
        column = start.column;
      }
      if (typeof end.offset === "number") {
        let pos = this.fromOffset(end.offset);
        endLine = pos.line;
        endColumn = pos.col;
      } else {
        endLine = end.line;
        endColumn = end.column;
      }
    } else if (!column) {
      let pos = this.fromOffset(line);
      line = pos.line;
      column = pos.col;
    }
    let origin = this.origin(line, column, endLine, endColumn);
    if (origin) {
      result2 = new CssSyntaxError$1$1(
        message,
        origin.endLine === void 0 ? origin.line : { column: origin.column, line: origin.line },
        origin.endLine === void 0 ? origin.column : { column: origin.endColumn, line: origin.endLine },
        origin.source,
        origin.file,
        opts.plugin
      );
    } else {
      result2 = new CssSyntaxError$1$1(
        message,
        endLine === void 0 ? line : { column, line },
        endLine === void 0 ? column : { column: endColumn, line: endLine },
        this.css,
        this.file,
        opts.plugin
      );
    }
    result2.input = { column, endColumn, endLine, line, source: this.css };
    if (this.file) {
      if (pathToFileURL$1$1) {
        result2.input.url = pathToFileURL$1$1(this.file).toString();
      }
      result2.input.file = this.file;
    }
    return result2;
  }
  fromOffset(offset) {
    let lastLine, lineToIndex;
    if (!this[fromOffsetCache$1]) {
      let lines = this.css.split("\n");
      lineToIndex = new Array(lines.length);
      let prevIndex = 0;
      for (let i2 = 0, l2 = lines.length; i2 < l2; i2++) {
        lineToIndex[i2] = prevIndex;
        prevIndex += lines[i2].length + 1;
      }
      this[fromOffsetCache$1] = lineToIndex;
    } else {
      lineToIndex = this[fromOffsetCache$1];
    }
    lastLine = lineToIndex[lineToIndex.length - 1];
    let min = 0;
    if (offset >= lastLine) {
      min = lineToIndex.length - 1;
    } else {
      let max2 = lineToIndex.length - 2;
      let mid;
      while (min < max2) {
        mid = min + (max2 - min >> 1);
        if (offset < lineToIndex[mid]) {
          max2 = mid - 1;
        } else if (offset >= lineToIndex[mid + 1]) {
          min = mid + 1;
        } else {
          min = mid;
          break;
        }
      }
    }
    return {
      col: offset - lineToIndex[min] + 1,
      line: min + 1
    };
  }
  mapResolve(file) {
    if (/^\w+:\/\//.test(file)) {
      return file;
    }
    return resolve$1$1(this.map.consumer().sourceRoot || this.map.root || ".", file);
  }
  origin(line, column, endLine, endColumn) {
    if (!this.map) return false;
    let consumer = this.map.consumer();
    let from = consumer.originalPositionFor({ column, line });
    if (!from.source) return false;
    let to;
    if (typeof endLine === "number") {
      to = consumer.originalPositionFor({ column: endColumn, line: endLine });
    }
    let fromUrl;
    if (isAbsolute$1(from.source)) {
      fromUrl = pathToFileURL$1$1(from.source);
    } else {
      fromUrl = new URL(
        from.source,
        this.map.consumer().sourceRoot || pathToFileURL$1$1(this.map.mapFile)
      );
    }
    let result2 = {
      column: from.column,
      endColumn: to && to.column,
      endLine: to && to.line,
      line: from.line,
      url: fromUrl.toString()
    };
    if (fromUrl.protocol === "file:") {
      if (fileURLToPath$1) {
        result2.file = fileURLToPath$1(fromUrl);
      } else {
        throw new Error(`file: protocol is not available in this PostCSS build`);
      }
    }
    let source = consumer.sourceContentFor(from.source);
    if (source) result2.source = source;
    return result2;
  }
  toJSON() {
    let json = {};
    for (let name of ["hasBOM", "css", "file", "id"]) {
      if (this[name] != null) {
        json[name] = this[name];
      }
    }
    if (this.map) {
      json.map = __spreadValues({}, this.map);
      if (json.map.consumerCache) {
        json.map.consumerCache = void 0;
      }
    }
    return json;
  }
  get from() {
    return this.file || this.id;
  }
};
var input$1 = Input$4$1;
Input$4$1.default = Input$4$1;
if (terminalHighlight$2 && terminalHighlight$2.registerInput) {
  terminalHighlight$2.registerInput(Input$4$1);
}
let { SourceMapConsumer: SourceMapConsumer$3, SourceMapGenerator: SourceMapGenerator$3 } = require$$2$1;
let { dirname: dirname$2, relative: relative$1, resolve: resolve$2, sep: sep$1 } = require$$2$1;
let { pathToFileURL: pathToFileURL$2 } = require$$2$1;
let Input$3$1 = input$1;
let sourceMapAvailable$2 = Boolean(SourceMapConsumer$3 && SourceMapGenerator$3);
let pathAvailable$2 = Boolean(dirname$2 && resolve$2 && relative$1 && sep$1);
let MapGenerator$2$1 = class MapGenerator {
  constructor(stringify2, root2, opts, cssString) {
    this.stringify = stringify2;
    this.mapOpts = opts.map || {};
    this.root = root2;
    this.opts = opts;
    this.css = cssString;
    this.originalCSS = cssString;
    this.usesFileUrls = !this.mapOpts.from && this.mapOpts.absolute;
    this.memoizedFileURLs = /* @__PURE__ */ new Map();
    this.memoizedPaths = /* @__PURE__ */ new Map();
    this.memoizedURLs = /* @__PURE__ */ new Map();
  }
  addAnnotation() {
    let content;
    if (this.isInline()) {
      content = "data:application/json;base64," + this.toBase64(this.map.toString());
    } else if (typeof this.mapOpts.annotation === "string") {
      content = this.mapOpts.annotation;
    } else if (typeof this.mapOpts.annotation === "function") {
      content = this.mapOpts.annotation(this.opts.to, this.root);
    } else {
      content = this.outputFile() + ".map";
    }
    let eol = "\n";
    if (this.css.includes("\r\n")) eol = "\r\n";
    this.css += eol + "/*# sourceMappingURL=" + content + " */";
  }
  applyPrevMaps() {
    for (let prev of this.previous()) {
      let from = this.toUrl(this.path(prev.file));
      let root2 = prev.root || dirname$2(prev.file);
      let map;
      if (this.mapOpts.sourcesContent === false) {
        map = new SourceMapConsumer$3(prev.text);
        if (map.sourcesContent) {
          map.sourcesContent = null;
        }
      } else {
        map = prev.consumer();
      }
      this.map.applySourceMap(map, from, this.toUrl(this.path(root2)));
    }
  }
  clearAnnotation() {
    if (this.mapOpts.annotation === false) return;
    if (this.root) {
      let node2;
      for (let i2 = this.root.nodes.length - 1; i2 >= 0; i2--) {
        node2 = this.root.nodes[i2];
        if (node2.type !== "comment") continue;
        if (node2.text.indexOf("# sourceMappingURL=") === 0) {
          this.root.removeChild(i2);
        }
      }
    } else if (this.css) {
      this.css = this.css.replace(/\n*?\/\*#[\S\s]*?\*\/$/gm, "");
    }
  }
  generate() {
    this.clearAnnotation();
    if (pathAvailable$2 && sourceMapAvailable$2 && this.isMap()) {
      return this.generateMap();
    } else {
      let result2 = "";
      this.stringify(this.root, (i2) => {
        result2 += i2;
      });
      return [result2];
    }
  }
  generateMap() {
    if (this.root) {
      this.generateString();
    } else if (this.previous().length === 1) {
      let prev = this.previous()[0].consumer();
      prev.file = this.outputFile();
      this.map = SourceMapGenerator$3.fromSourceMap(prev, {
        ignoreInvalidMapping: true
      });
    } else {
      this.map = new SourceMapGenerator$3({
        file: this.outputFile(),
        ignoreInvalidMapping: true
      });
      this.map.addMapping({
        generated: { column: 0, line: 1 },
        original: { column: 0, line: 1 },
        source: this.opts.from ? this.toUrl(this.path(this.opts.from)) : "<no source>"
      });
    }
    if (this.isSourcesContent()) this.setSourcesContent();
    if (this.root && this.previous().length > 0) this.applyPrevMaps();
    if (this.isAnnotation()) this.addAnnotation();
    if (this.isInline()) {
      return [this.css];
    } else {
      return [this.css, this.map];
    }
  }
  generateString() {
    this.css = "";
    this.map = new SourceMapGenerator$3({
      file: this.outputFile(),
      ignoreInvalidMapping: true
    });
    let line = 1;
    let column = 1;
    let noSource = "<no source>";
    let mapping = {
      generated: { column: 0, line: 0 },
      original: { column: 0, line: 0 },
      source: ""
    };
    let lines, last;
    this.stringify(this.root, (str, node2, type) => {
      this.css += str;
      if (node2 && type !== "end") {
        mapping.generated.line = line;
        mapping.generated.column = column - 1;
        if (node2.source && node2.source.start) {
          mapping.source = this.sourcePath(node2);
          mapping.original.line = node2.source.start.line;
          mapping.original.column = node2.source.start.column - 1;
          this.map.addMapping(mapping);
        } else {
          mapping.source = noSource;
          mapping.original.line = 1;
          mapping.original.column = 0;
          this.map.addMapping(mapping);
        }
      }
      lines = str.match(/\n/g);
      if (lines) {
        line += lines.length;
        last = str.lastIndexOf("\n");
        column = str.length - last;
      } else {
        column += str.length;
      }
      if (node2 && type !== "start") {
        let p = node2.parent || { raws: {} };
        let childless = node2.type === "decl" || node2.type === "atrule" && !node2.nodes;
        if (!childless || node2 !== p.last || p.raws.semicolon) {
          if (node2.source && node2.source.end) {
            mapping.source = this.sourcePath(node2);
            mapping.original.line = node2.source.end.line;
            mapping.original.column = node2.source.end.column - 1;
            mapping.generated.line = line;
            mapping.generated.column = column - 2;
            this.map.addMapping(mapping);
          } else {
            mapping.source = noSource;
            mapping.original.line = 1;
            mapping.original.column = 0;
            mapping.generated.line = line;
            mapping.generated.column = column - 1;
            this.map.addMapping(mapping);
          }
        }
      }
    });
  }
  isAnnotation() {
    if (this.isInline()) {
      return true;
    }
    if (typeof this.mapOpts.annotation !== "undefined") {
      return this.mapOpts.annotation;
    }
    if (this.previous().length) {
      return this.previous().some((i2) => i2.annotation);
    }
    return true;
  }
  isInline() {
    if (typeof this.mapOpts.inline !== "undefined") {
      return this.mapOpts.inline;
    }
    let annotation = this.mapOpts.annotation;
    if (typeof annotation !== "undefined" && annotation !== true) {
      return false;
    }
    if (this.previous().length) {
      return this.previous().some((i2) => i2.inline);
    }
    return true;
  }
  isMap() {
    if (typeof this.opts.map !== "undefined") {
      return !!this.opts.map;
    }
    return this.previous().length > 0;
  }
  isSourcesContent() {
    if (typeof this.mapOpts.sourcesContent !== "undefined") {
      return this.mapOpts.sourcesContent;
    }
    if (this.previous().length) {
      return this.previous().some((i2) => i2.withContent());
    }
    return true;
  }
  outputFile() {
    if (this.opts.to) {
      return this.path(this.opts.to);
    } else if (this.opts.from) {
      return this.path(this.opts.from);
    } else {
      return "to.css";
    }
  }
  path(file) {
    if (this.mapOpts.absolute) return file;
    if (file.charCodeAt(0) === 60) return file;
    if (/^\w+:\/\//.test(file)) return file;
    let cached = this.memoizedPaths.get(file);
    if (cached) return cached;
    let from = this.opts.to ? dirname$2(this.opts.to) : ".";
    if (typeof this.mapOpts.annotation === "string") {
      from = dirname$2(resolve$2(from, this.mapOpts.annotation));
    }
    let path = relative$1(from, file);
    this.memoizedPaths.set(file, path);
    return path;
  }
  previous() {
    if (!this.previousMaps) {
      this.previousMaps = [];
      if (this.root) {
        this.root.walk((node2) => {
          if (node2.source && node2.source.input.map) {
            let map = node2.source.input.map;
            if (!this.previousMaps.includes(map)) {
              this.previousMaps.push(map);
            }
          }
        });
      } else {
        let input2 = new Input$3$1(this.originalCSS, this.opts);
        if (input2.map) this.previousMaps.push(input2.map);
      }
    }
    return this.previousMaps;
  }
  setSourcesContent() {
    let already = {};
    if (this.root) {
      this.root.walk((node2) => {
        if (node2.source) {
          let from = node2.source.input.from;
          if (from && !already[from]) {
            already[from] = true;
            let fromUrl = this.usesFileUrls ? this.toFileUrl(from) : this.toUrl(this.path(from));
            this.map.setSourceContent(fromUrl, node2.source.input.css);
          }
        }
      });
    } else if (this.css) {
      let from = this.opts.from ? this.toUrl(this.path(this.opts.from)) : "<no source>";
      this.map.setSourceContent(from, this.css);
    }
  }
  sourcePath(node2) {
    if (this.mapOpts.from) {
      return this.toUrl(this.mapOpts.from);
    } else if (this.usesFileUrls) {
      return this.toFileUrl(node2.source.input.from);
    } else {
      return this.toUrl(this.path(node2.source.input.from));
    }
  }
  toBase64(str) {
    if (Buffer) {
      return Buffer.from(str).toString("base64");
    } else {
      return window.btoa(unescape(encodeURIComponent(str)));
    }
  }
  toFileUrl(path) {
    let cached = this.memoizedFileURLs.get(path);
    if (cached) return cached;
    if (pathToFileURL$2) {
      let fileURL = pathToFileURL$2(path).toString();
      this.memoizedFileURLs.set(path, fileURL);
      return fileURL;
    } else {
      throw new Error(
        "`map.absolute` option is not available in this PostCSS build"
      );
    }
  }
  toUrl(path) {
    let cached = this.memoizedURLs.get(path);
    if (cached) return cached;
    if (sep$1 === "\\") {
      path = path.replace(/\\/g, "/");
    }
    let url = encodeURI(path).replace(/[#?]/g, encodeURIComponent);
    this.memoizedURLs.set(path, url);
    return url;
  }
};
var mapGenerator$1 = MapGenerator$2$1;
let Node$2$1 = node$1;
let Comment$4$1 = class Comment extends Node$2$1 {
  constructor(defaults) {
    super(defaults);
    this.type = "comment";
  }
};
var comment$1 = Comment$4$1;
Comment$4$1.default = Comment$4$1;
let { isClean: isClean$1$1, my: my$1$1 } = symbols$1;
let Declaration$3$1 = declaration$1;
let Comment$3$1 = comment$1;
let Node$1$1 = node$1;
let parse$4$1;
let Rule$4$1;
let AtRule$4$1;
let Root$6$1;
function cleanSource$1(nodes) {
  return nodes.map((i2) => {
    if (i2.nodes) i2.nodes = cleanSource$1(i2.nodes);
    delete i2.source;
    return i2;
  });
}
function markDirtyUp$1(node2) {
  node2[isClean$1$1] = false;
  if (node2.proxyOf.nodes) {
    for (let i2 of node2.proxyOf.nodes) {
      markDirtyUp$1(i2);
    }
  }
}
let Container$7$1 = class Container extends Node$1$1 {
  append(...children2) {
    for (let child of children2) {
      let nodes = this.normalize(child, this.last);
      for (let node2 of nodes) this.proxyOf.nodes.push(node2);
    }
    this.markDirty();
    return this;
  }
  cleanRaws(keepBetween) {
    super.cleanRaws(keepBetween);
    if (this.nodes) {
      for (let node2 of this.nodes) node2.cleanRaws(keepBetween);
    }
  }
  each(callback) {
    if (!this.proxyOf.nodes) return void 0;
    let iterator = this.getIterator();
    let index2, result2;
    while (this.indexes[iterator] < this.proxyOf.nodes.length) {
      index2 = this.indexes[iterator];
      result2 = callback(this.proxyOf.nodes[index2], index2);
      if (result2 === false) break;
      this.indexes[iterator] += 1;
    }
    delete this.indexes[iterator];
    return result2;
  }
  every(condition) {
    return this.nodes.every(condition);
  }
  getIterator() {
    if (!this.lastEach) this.lastEach = 0;
    if (!this.indexes) this.indexes = {};
    this.lastEach += 1;
    let iterator = this.lastEach;
    this.indexes[iterator] = 0;
    return iterator;
  }
  getProxyProcessor() {
    return {
      get(node2, prop) {
        if (prop === "proxyOf") {
          return node2;
        } else if (!node2[prop]) {
          return node2[prop];
        } else if (prop === "each" || typeof prop === "string" && prop.startsWith("walk")) {
          return (...args) => {
            return node2[prop](
              ...args.map((i2) => {
                if (typeof i2 === "function") {
                  return (child, index2) => i2(child.toProxy(), index2);
                } else {
                  return i2;
                }
              })
            );
          };
        } else if (prop === "every" || prop === "some") {
          return (cb) => {
            return node2[prop](
              (child, ...other) => cb(child.toProxy(), ...other)
            );
          };
        } else if (prop === "root") {
          return () => node2.root().toProxy();
        } else if (prop === "nodes") {
          return node2.nodes.map((i2) => i2.toProxy());
        } else if (prop === "first" || prop === "last") {
          return node2[prop].toProxy();
        } else {
          return node2[prop];
        }
      },
      set(node2, prop, value) {
        if (node2[prop] === value) return true;
        node2[prop] = value;
        if (prop === "name" || prop === "params" || prop === "selector") {
          node2.markDirty();
        }
        return true;
      }
    };
  }
  index(child) {
    if (typeof child === "number") return child;
    if (child.proxyOf) child = child.proxyOf;
    return this.proxyOf.nodes.indexOf(child);
  }
  insertAfter(exist, add) {
    let existIndex = this.index(exist);
    let nodes = this.normalize(add, this.proxyOf.nodes[existIndex]).reverse();
    existIndex = this.index(exist);
    for (let node2 of nodes) this.proxyOf.nodes.splice(existIndex + 1, 0, node2);
    let index2;
    for (let id in this.indexes) {
      index2 = this.indexes[id];
      if (existIndex < index2) {
        this.indexes[id] = index2 + nodes.length;
      }
    }
    this.markDirty();
    return this;
  }
  insertBefore(exist, add) {
    let existIndex = this.index(exist);
    let type = existIndex === 0 ? "prepend" : false;
    let nodes = this.normalize(add, this.proxyOf.nodes[existIndex], type).reverse();
    existIndex = this.index(exist);
    for (let node2 of nodes) this.proxyOf.nodes.splice(existIndex, 0, node2);
    let index2;
    for (let id in this.indexes) {
      index2 = this.indexes[id];
      if (existIndex <= index2) {
        this.indexes[id] = index2 + nodes.length;
      }
    }
    this.markDirty();
    return this;
  }
  normalize(nodes, sample) {
    if (typeof nodes === "string") {
      nodes = cleanSource$1(parse$4$1(nodes).nodes);
    } else if (typeof nodes === "undefined") {
      nodes = [];
    } else if (Array.isArray(nodes)) {
      nodes = nodes.slice(0);
      for (let i2 of nodes) {
        if (i2.parent) i2.parent.removeChild(i2, "ignore");
      }
    } else if (nodes.type === "root" && this.type !== "document") {
      nodes = nodes.nodes.slice(0);
      for (let i2 of nodes) {
        if (i2.parent) i2.parent.removeChild(i2, "ignore");
      }
    } else if (nodes.type) {
      nodes = [nodes];
    } else if (nodes.prop) {
      if (typeof nodes.value === "undefined") {
        throw new Error("Value field is missed in node creation");
      } else if (typeof nodes.value !== "string") {
        nodes.value = String(nodes.value);
      }
      nodes = [new Declaration$3$1(nodes)];
    } else if (nodes.selector) {
      nodes = [new Rule$4$1(nodes)];
    } else if (nodes.name) {
      nodes = [new AtRule$4$1(nodes)];
    } else if (nodes.text) {
      nodes = [new Comment$3$1(nodes)];
    } else {
      throw new Error("Unknown node type in node creation");
    }
    let processed = nodes.map((i2) => {
      if (!i2[my$1$1]) Container.rebuild(i2);
      i2 = i2.proxyOf;
      if (i2.parent) i2.parent.removeChild(i2);
      if (i2[isClean$1$1]) markDirtyUp$1(i2);
      if (typeof i2.raws.before === "undefined") {
        if (sample && typeof sample.raws.before !== "undefined") {
          i2.raws.before = sample.raws.before.replace(/\S/g, "");
        }
      }
      i2.parent = this.proxyOf;
      return i2;
    });
    return processed;
  }
  prepend(...children2) {
    children2 = children2.reverse();
    for (let child of children2) {
      let nodes = this.normalize(child, this.first, "prepend").reverse();
      for (let node2 of nodes) this.proxyOf.nodes.unshift(node2);
      for (let id in this.indexes) {
        this.indexes[id] = this.indexes[id] + nodes.length;
      }
    }
    this.markDirty();
    return this;
  }
  push(child) {
    child.parent = this;
    this.proxyOf.nodes.push(child);
    return this;
  }
  removeAll() {
    for (let node2 of this.proxyOf.nodes) node2.parent = void 0;
    this.proxyOf.nodes = [];
    this.markDirty();
    return this;
  }
  removeChild(child) {
    child = this.index(child);
    this.proxyOf.nodes[child].parent = void 0;
    this.proxyOf.nodes.splice(child, 1);
    let index2;
    for (let id in this.indexes) {
      index2 = this.indexes[id];
      if (index2 >= child) {
        this.indexes[id] = index2 - 1;
      }
    }
    this.markDirty();
    return this;
  }
  replaceValues(pattern, opts, callback) {
    if (!callback) {
      callback = opts;
      opts = {};
    }
    this.walkDecls((decl) => {
      if (opts.props && !opts.props.includes(decl.prop)) return;
      if (opts.fast && !decl.value.includes(opts.fast)) return;
      decl.value = decl.value.replace(pattern, callback);
    });
    this.markDirty();
    return this;
  }
  some(condition) {
    return this.nodes.some(condition);
  }
  walk(callback) {
    return this.each((child, i2) => {
      let result2;
      try {
        result2 = callback(child, i2);
      } catch (e2) {
        throw child.addToError(e2);
      }
      if (result2 !== false && child.walk) {
        result2 = child.walk(callback);
      }
      return result2;
    });
  }
  walkAtRules(name, callback) {
    if (!callback) {
      callback = name;
      return this.walk((child, i2) => {
        if (child.type === "atrule") {
          return callback(child, i2);
        }
      });
    }
    if (name instanceof RegExp) {
      return this.walk((child, i2) => {
        if (child.type === "atrule" && name.test(child.name)) {
          return callback(child, i2);
        }
      });
    }
    return this.walk((child, i2) => {
      if (child.type === "atrule" && child.name === name) {
        return callback(child, i2);
      }
    });
  }
  walkComments(callback) {
    return this.walk((child, i2) => {
      if (child.type === "comment") {
        return callback(child, i2);
      }
    });
  }
  walkDecls(prop, callback) {
    if (!callback) {
      callback = prop;
      return this.walk((child, i2) => {
        if (child.type === "decl") {
          return callback(child, i2);
        }
      });
    }
    if (prop instanceof RegExp) {
      return this.walk((child, i2) => {
        if (child.type === "decl" && prop.test(child.prop)) {
          return callback(child, i2);
        }
      });
    }
    return this.walk((child, i2) => {
      if (child.type === "decl" && child.prop === prop) {
        return callback(child, i2);
      }
    });
  }
  walkRules(selector, callback) {
    if (!callback) {
      callback = selector;
      return this.walk((child, i2) => {
        if (child.type === "rule") {
          return callback(child, i2);
        }
      });
    }
    if (selector instanceof RegExp) {
      return this.walk((child, i2) => {
        if (child.type === "rule" && selector.test(child.selector)) {
          return callback(child, i2);
        }
      });
    }
    return this.walk((child, i2) => {
      if (child.type === "rule" && child.selector === selector) {
        return callback(child, i2);
      }
    });
  }
  get first() {
    if (!this.proxyOf.nodes) return void 0;
    return this.proxyOf.nodes[0];
  }
  get last() {
    if (!this.proxyOf.nodes) return void 0;
    return this.proxyOf.nodes[this.proxyOf.nodes.length - 1];
  }
};
Container$7$1.registerParse = (dependant) => {
  parse$4$1 = dependant;
};
Container$7$1.registerRule = (dependant) => {
  Rule$4$1 = dependant;
};
Container$7$1.registerAtRule = (dependant) => {
  AtRule$4$1 = dependant;
};
Container$7$1.registerRoot = (dependant) => {
  Root$6$1 = dependant;
};
var container$1 = Container$7$1;
Container$7$1.default = Container$7$1;
Container$7$1.rebuild = (node2) => {
  if (node2.type === "atrule") {
    Object.setPrototypeOf(node2, AtRule$4$1.prototype);
  } else if (node2.type === "rule") {
    Object.setPrototypeOf(node2, Rule$4$1.prototype);
  } else if (node2.type === "decl") {
    Object.setPrototypeOf(node2, Declaration$3$1.prototype);
  } else if (node2.type === "comment") {
    Object.setPrototypeOf(node2, Comment$3$1.prototype);
  } else if (node2.type === "root") {
    Object.setPrototypeOf(node2, Root$6$1.prototype);
  }
  node2[my$1$1] = true;
  if (node2.nodes) {
    node2.nodes.forEach((child) => {
      Container$7$1.rebuild(child);
    });
  }
};
let Container$6$1 = container$1;
let LazyResult$4$1;
let Processor$3$1;
let Document$3$1 = class Document2 extends Container$6$1 {
  constructor(defaults) {
    super(__spreadValues({ type: "document" }, defaults));
    if (!this.nodes) {
      this.nodes = [];
    }
  }
  toResult(opts = {}) {
    let lazy = new LazyResult$4$1(new Processor$3$1(), this, opts);
    return lazy.stringify();
  }
};
Document$3$1.registerLazyResult = (dependant) => {
  LazyResult$4$1 = dependant;
};
Document$3$1.registerProcessor = (dependant) => {
  Processor$3$1 = dependant;
};
var document$1$1 = Document$3$1;
Document$3$1.default = Document$3$1;
let printed$1 = {};
var warnOnce$2$1 = function warnOnce(message) {
  if (printed$1[message]) return;
  printed$1[message] = true;
  if (typeof console !== "undefined" && console.warn) {
    console.warn(message);
  }
};
let Warning$2$1 = class Warning {
  constructor(text2, opts = {}) {
    this.type = "warning";
    this.text = text2;
    if (opts.node && opts.node.source) {
      let range = opts.node.rangeBy(opts);
      this.line = range.start.line;
      this.column = range.start.column;
      this.endLine = range.end.line;
      this.endColumn = range.end.column;
    }
    for (let opt in opts) this[opt] = opts[opt];
  }
  toString() {
    if (this.node) {
      return this.node.error(this.text, {
        index: this.index,
        plugin: this.plugin,
        word: this.word
      }).message;
    }
    if (this.plugin) {
      return this.plugin + ": " + this.text;
    }
    return this.text;
  }
};
var warning$1 = Warning$2$1;
Warning$2$1.default = Warning$2$1;
let Warning$1$1 = warning$1;
let Result$3$1 = class Result {
  constructor(processor2, root2, opts) {
    this.processor = processor2;
    this.messages = [];
    this.root = root2;
    this.opts = opts;
    this.css = void 0;
    this.map = void 0;
  }
  toString() {
    return this.css;
  }
  warn(text2, opts = {}) {
    if (!opts.plugin) {
      if (this.lastPlugin && this.lastPlugin.postcssPlugin) {
        opts.plugin = this.lastPlugin.postcssPlugin;
      }
    }
    let warning2 = new Warning$1$1(text2, opts);
    this.messages.push(warning2);
    return warning2;
  }
  warnings() {
    return this.messages.filter((i2) => i2.type === "warning");
  }
  get content() {
    return this.css;
  }
};
var result$1 = Result$3$1;
Result$3$1.default = Result$3$1;
const SINGLE_QUOTE$1 = "'".charCodeAt(0);
const DOUBLE_QUOTE$1 = '"'.charCodeAt(0);
const BACKSLASH$1 = "\\".charCodeAt(0);
const SLASH$1 = "/".charCodeAt(0);
const NEWLINE$1 = "\n".charCodeAt(0);
const SPACE$1 = " ".charCodeAt(0);
const FEED$1 = "\f".charCodeAt(0);
const TAB$1 = "	".charCodeAt(0);
const CR$1 = "\r".charCodeAt(0);
const OPEN_SQUARE$1 = "[".charCodeAt(0);
const CLOSE_SQUARE$1 = "]".charCodeAt(0);
const OPEN_PARENTHESES$1 = "(".charCodeAt(0);
const CLOSE_PARENTHESES$1 = ")".charCodeAt(0);
const OPEN_CURLY$1 = "{".charCodeAt(0);
const CLOSE_CURLY$1 = "}".charCodeAt(0);
const SEMICOLON$1 = ";".charCodeAt(0);
const ASTERISK$1 = "*".charCodeAt(0);
const COLON$1 = ":".charCodeAt(0);
const AT$1 = "@".charCodeAt(0);
const RE_AT_END$1 = /[\t\n\f\r "#'()/;[\\\]{}]/g;
const RE_WORD_END$1 = /[\t\n\f\r !"#'():;@[\\\]{}]|\/(?=\*)/g;
const RE_BAD_BRACKET$1 = /.[\r\n"'(/\\]/;
const RE_HEX_ESCAPE$1 = /[\da-f]/i;
var tokenize$1 = function tokenizer(input2, options = {}) {
  let css = input2.css.valueOf();
  let ignore = options.ignoreErrors;
  let code, next, quote, content, escape;
  let escaped, escapePos, prev, n2, currentToken;
  let length = css.length;
  let pos = 0;
  let buffer = [];
  let returned = [];
  function position2() {
    return pos;
  }
  function unclosed(what) {
    throw input2.error("Unclosed " + what, pos);
  }
  function endOfFile() {
    return returned.length === 0 && pos >= length;
  }
  function nextToken(opts) {
    if (returned.length) return returned.pop();
    if (pos >= length) return;
    let ignoreUnclosed = opts ? opts.ignoreUnclosed : false;
    code = css.charCodeAt(pos);
    switch (code) {
      case NEWLINE$1:
      case SPACE$1:
      case TAB$1:
      case CR$1:
      case FEED$1: {
        next = pos;
        do {
          next += 1;
          code = css.charCodeAt(next);
        } while (code === SPACE$1 || code === NEWLINE$1 || code === TAB$1 || code === CR$1 || code === FEED$1);
        currentToken = ["space", css.slice(pos, next)];
        pos = next - 1;
        break;
      }
      case OPEN_SQUARE$1:
      case CLOSE_SQUARE$1:
      case OPEN_CURLY$1:
      case CLOSE_CURLY$1:
      case COLON$1:
      case SEMICOLON$1:
      case CLOSE_PARENTHESES$1: {
        let controlChar = String.fromCharCode(code);
        currentToken = [controlChar, controlChar, pos];
        break;
      }
      case OPEN_PARENTHESES$1: {
        prev = buffer.length ? buffer.pop()[1] : "";
        n2 = css.charCodeAt(pos + 1);
        if (prev === "url" && n2 !== SINGLE_QUOTE$1 && n2 !== DOUBLE_QUOTE$1 && n2 !== SPACE$1 && n2 !== NEWLINE$1 && n2 !== TAB$1 && n2 !== FEED$1 && n2 !== CR$1) {
          next = pos;
          do {
            escaped = false;
            next = css.indexOf(")", next + 1);
            if (next === -1) {
              if (ignore || ignoreUnclosed) {
                next = pos;
                break;
              } else {
                unclosed("bracket");
              }
            }
            escapePos = next;
            while (css.charCodeAt(escapePos - 1) === BACKSLASH$1) {
              escapePos -= 1;
              escaped = !escaped;
            }
          } while (escaped);
          currentToken = ["brackets", css.slice(pos, next + 1), pos, next];
          pos = next;
        } else {
          next = css.indexOf(")", pos + 1);
          content = css.slice(pos, next + 1);
          if (next === -1 || RE_BAD_BRACKET$1.test(content)) {
            currentToken = ["(", "(", pos];
          } else {
            currentToken = ["brackets", content, pos, next];
            pos = next;
          }
        }
        break;
      }
      case SINGLE_QUOTE$1:
      case DOUBLE_QUOTE$1: {
        quote = code === SINGLE_QUOTE$1 ? "'" : '"';
        next = pos;
        do {
          escaped = false;
          next = css.indexOf(quote, next + 1);
          if (next === -1) {
            if (ignore || ignoreUnclosed) {
              next = pos + 1;
              break;
            } else {
              unclosed("string");
            }
          }
          escapePos = next;
          while (css.charCodeAt(escapePos - 1) === BACKSLASH$1) {
            escapePos -= 1;
            escaped = !escaped;
          }
        } while (escaped);
        currentToken = ["string", css.slice(pos, next + 1), pos, next];
        pos = next;
        break;
      }
      case AT$1: {
        RE_AT_END$1.lastIndex = pos + 1;
        RE_AT_END$1.test(css);
        if (RE_AT_END$1.lastIndex === 0) {
          next = css.length - 1;
        } else {
          next = RE_AT_END$1.lastIndex - 2;
        }
        currentToken = ["at-word", css.slice(pos, next + 1), pos, next];
        pos = next;
        break;
      }
      case BACKSLASH$1: {
        next = pos;
        escape = true;
        while (css.charCodeAt(next + 1) === BACKSLASH$1) {
          next += 1;
          escape = !escape;
        }
        code = css.charCodeAt(next + 1);
        if (escape && code !== SLASH$1 && code !== SPACE$1 && code !== NEWLINE$1 && code !== TAB$1 && code !== CR$1 && code !== FEED$1) {
          next += 1;
          if (RE_HEX_ESCAPE$1.test(css.charAt(next))) {
            while (RE_HEX_ESCAPE$1.test(css.charAt(next + 1))) {
              next += 1;
            }
            if (css.charCodeAt(next + 1) === SPACE$1) {
              next += 1;
            }
          }
        }
        currentToken = ["word", css.slice(pos, next + 1), pos, next];
        pos = next;
        break;
      }
      default: {
        if (code === SLASH$1 && css.charCodeAt(pos + 1) === ASTERISK$1) {
          next = css.indexOf("*/", pos + 2) + 1;
          if (next === 0) {
            if (ignore || ignoreUnclosed) {
              next = css.length;
            } else {
              unclosed("comment");
            }
          }
          currentToken = ["comment", css.slice(pos, next + 1), pos, next];
          pos = next;
        } else {
          RE_WORD_END$1.lastIndex = pos + 1;
          RE_WORD_END$1.test(css);
          if (RE_WORD_END$1.lastIndex === 0) {
            next = css.length - 1;
          } else {
            next = RE_WORD_END$1.lastIndex - 2;
          }
          currentToken = ["word", css.slice(pos, next + 1), pos, next];
          buffer.push(currentToken);
          pos = next;
        }
        break;
      }
    }
    pos++;
    return currentToken;
  }
  function back(token) {
    returned.push(token);
  }
  return {
    back,
    endOfFile,
    nextToken,
    position: position2
  };
};
let Container$5$1 = container$1;
let AtRule$3$1 = class AtRule extends Container$5$1 {
  constructor(defaults) {
    super(defaults);
    this.type = "atrule";
  }
  append(...children2) {
    if (!this.proxyOf.nodes) this.nodes = [];
    return super.append(...children2);
  }
  prepend(...children2) {
    if (!this.proxyOf.nodes) this.nodes = [];
    return super.prepend(...children2);
  }
};
var atRule$1 = AtRule$3$1;
AtRule$3$1.default = AtRule$3$1;
Container$5$1.registerAtRule(AtRule$3$1);
let Container$4$1 = container$1;
let LazyResult$3$1;
let Processor$2$1;
let Root$5$1 = class Root extends Container$4$1 {
  constructor(defaults) {
    super(defaults);
    this.type = "root";
    if (!this.nodes) this.nodes = [];
  }
  normalize(child, sample, type) {
    let nodes = super.normalize(child);
    if (sample) {
      if (type === "prepend") {
        if (this.nodes.length > 1) {
          sample.raws.before = this.nodes[1].raws.before;
        } else {
          delete sample.raws.before;
        }
      } else if (this.first !== sample) {
        for (let node2 of nodes) {
          node2.raws.before = sample.raws.before;
        }
      }
    }
    return nodes;
  }
  removeChild(child, ignore) {
    let index2 = this.index(child);
    if (!ignore && index2 === 0 && this.nodes.length > 1) {
      this.nodes[1].raws.before = this.nodes[index2].raws.before;
    }
    return super.removeChild(child);
  }
  toResult(opts = {}) {
    let lazy = new LazyResult$3$1(new Processor$2$1(), this, opts);
    return lazy.stringify();
  }
};
Root$5$1.registerLazyResult = (dependant) => {
  LazyResult$3$1 = dependant;
};
Root$5$1.registerProcessor = (dependant) => {
  Processor$2$1 = dependant;
};
var root$1 = Root$5$1;
Root$5$1.default = Root$5$1;
Container$4$1.registerRoot(Root$5$1);
let list$2$1 = {
  comma(string) {
    return list$2$1.split(string, [","], true);
  },
  space(string) {
    let spaces = [" ", "\n", "	"];
    return list$2$1.split(string, spaces);
  },
  split(string, separators, last) {
    let array = [];
    let current = "";
    let split = false;
    let func = 0;
    let inQuote = false;
    let prevQuote = "";
    let escape = false;
    for (let letter of string) {
      if (escape) {
        escape = false;
      } else if (letter === "\\") {
        escape = true;
      } else if (inQuote) {
        if (letter === prevQuote) {
          inQuote = false;
        }
      } else if (letter === '"' || letter === "'") {
        inQuote = true;
        prevQuote = letter;
      } else if (letter === "(") {
        func += 1;
      } else if (letter === ")") {
        if (func > 0) func -= 1;
      } else if (func === 0) {
        if (separators.includes(letter)) split = true;
      }
      if (split) {
        if (current !== "") array.push(current.trim());
        current = "";
        split = false;
      } else {
        current += letter;
      }
    }
    if (last || current !== "") array.push(current.trim());
    return array;
  }
};
var list_1$1 = list$2$1;
list$2$1.default = list$2$1;
let Container$3$1 = container$1;
let list$1$1 = list_1$1;
let Rule$3$1 = class Rule extends Container$3$1 {
  constructor(defaults) {
    super(defaults);
    this.type = "rule";
    if (!this.nodes) this.nodes = [];
  }
  get selectors() {
    return list$1$1.comma(this.selector);
  }
  set selectors(values) {
    let match = this.selector ? this.selector.match(/,\s*/) : null;
    let sep2 = match ? match[0] : "," + this.raw("between", "beforeOpen");
    this.selector = values.join(sep2);
  }
};
var rule$1 = Rule$3$1;
Rule$3$1.default = Rule$3$1;
Container$3$1.registerRule(Rule$3$1);
let Declaration$2$1 = declaration$1;
let tokenizer2$1 = tokenize$1;
let Comment$2$1 = comment$1;
let AtRule$2$1 = atRule$1;
let Root$4$1 = root$1;
let Rule$2$1 = rule$1;
const SAFE_COMMENT_NEIGHBOR$1 = {
  empty: true,
  space: true
};
function findLastWithPosition$1(tokens) {
  for (let i2 = tokens.length - 1; i2 >= 0; i2--) {
    let token = tokens[i2];
    let pos = token[3] || token[2];
    if (pos) return pos;
  }
}
let Parser$1$1 = class Parser {
  constructor(input2) {
    this.input = input2;
    this.root = new Root$4$1();
    this.current = this.root;
    this.spaces = "";
    this.semicolon = false;
    this.createTokenizer();
    this.root.source = { input: input2, start: { column: 1, line: 1, offset: 0 } };
  }
  atrule(token) {
    let node2 = new AtRule$2$1();
    node2.name = token[1].slice(1);
    if (node2.name === "") {
      this.unnamedAtrule(node2, token);
    }
    this.init(node2, token[2]);
    let type;
    let prev;
    let shift;
    let last = false;
    let open = false;
    let params = [];
    let brackets = [];
    while (!this.tokenizer.endOfFile()) {
      token = this.tokenizer.nextToken();
      type = token[0];
      if (type === "(" || type === "[") {
        brackets.push(type === "(" ? ")" : "]");
      } else if (type === "{" && brackets.length > 0) {
        brackets.push("}");
      } else if (type === brackets[brackets.length - 1]) {
        brackets.pop();
      }
      if (brackets.length === 0) {
        if (type === ";") {
          node2.source.end = this.getPosition(token[2]);
          node2.source.end.offset++;
          this.semicolon = true;
          break;
        } else if (type === "{") {
          open = true;
          break;
        } else if (type === "}") {
          if (params.length > 0) {
            shift = params.length - 1;
            prev = params[shift];
            while (prev && prev[0] === "space") {
              prev = params[--shift];
            }
            if (prev) {
              node2.source.end = this.getPosition(prev[3] || prev[2]);
              node2.source.end.offset++;
            }
          }
          this.end(token);
          break;
        } else {
          params.push(token);
        }
      } else {
        params.push(token);
      }
      if (this.tokenizer.endOfFile()) {
        last = true;
        break;
      }
    }
    node2.raws.between = this.spacesAndCommentsFromEnd(params);
    if (params.length) {
      node2.raws.afterName = this.spacesAndCommentsFromStart(params);
      this.raw(node2, "params", params);
      if (last) {
        token = params[params.length - 1];
        node2.source.end = this.getPosition(token[3] || token[2]);
        node2.source.end.offset++;
        this.spaces = node2.raws.between;
        node2.raws.between = "";
      }
    } else {
      node2.raws.afterName = "";
      node2.params = "";
    }
    if (open) {
      node2.nodes = [];
      this.current = node2;
    }
  }
  checkMissedSemicolon(tokens) {
    let colon = this.colon(tokens);
    if (colon === false) return;
    let founded = 0;
    let token;
    for (let j = colon - 1; j >= 0; j--) {
      token = tokens[j];
      if (token[0] !== "space") {
        founded += 1;
        if (founded === 2) break;
      }
    }
    throw this.input.error(
      "Missed semicolon",
      token[0] === "word" ? token[3] + 1 : token[2]
    );
  }
  colon(tokens) {
    let brackets = 0;
    let token, type, prev;
    for (let [i2, element2] of tokens.entries()) {
      token = element2;
      type = token[0];
      if (type === "(") {
        brackets += 1;
      }
      if (type === ")") {
        brackets -= 1;
      }
      if (brackets === 0 && type === ":") {
        if (!prev) {
          this.doubleColon(token);
        } else if (prev[0] === "word" && prev[1] === "progid") {
          continue;
        } else {
          return i2;
        }
      }
      prev = token;
    }
    return false;
  }
  comment(token) {
    let node2 = new Comment$2$1();
    this.init(node2, token[2]);
    node2.source.end = this.getPosition(token[3] || token[2]);
    node2.source.end.offset++;
    let text2 = token[1].slice(2, -2);
    if (/^\s*$/.test(text2)) {
      node2.text = "";
      node2.raws.left = text2;
      node2.raws.right = "";
    } else {
      let match = text2.match(/^(\s*)([^]*\S)(\s*)$/);
      node2.text = match[2];
      node2.raws.left = match[1];
      node2.raws.right = match[3];
    }
  }
  createTokenizer() {
    this.tokenizer = tokenizer2$1(this.input);
  }
  decl(tokens, customProperty) {
    let node2 = new Declaration$2$1();
    this.init(node2, tokens[0][2]);
    let last = tokens[tokens.length - 1];
    if (last[0] === ";") {
      this.semicolon = true;
      tokens.pop();
    }
    node2.source.end = this.getPosition(
      last[3] || last[2] || findLastWithPosition$1(tokens)
    );
    node2.source.end.offset++;
    while (tokens[0][0] !== "word") {
      if (tokens.length === 1) this.unknownWord(tokens);
      node2.raws.before += tokens.shift()[1];
    }
    node2.source.start = this.getPosition(tokens[0][2]);
    node2.prop = "";
    while (tokens.length) {
      let type = tokens[0][0];
      if (type === ":" || type === "space" || type === "comment") {
        break;
      }
      node2.prop += tokens.shift()[1];
    }
    node2.raws.between = "";
    let token;
    while (tokens.length) {
      token = tokens.shift();
      if (token[0] === ":") {
        node2.raws.between += token[1];
        break;
      } else {
        if (token[0] === "word" && /\w/.test(token[1])) {
          this.unknownWord([token]);
        }
        node2.raws.between += token[1];
      }
    }
    if (node2.prop[0] === "_" || node2.prop[0] === "*") {
      node2.raws.before += node2.prop[0];
      node2.prop = node2.prop.slice(1);
    }
    let firstSpaces = [];
    let next;
    while (tokens.length) {
      next = tokens[0][0];
      if (next !== "space" && next !== "comment") break;
      firstSpaces.push(tokens.shift());
    }
    this.precheckMissedSemicolon(tokens);
    for (let i2 = tokens.length - 1; i2 >= 0; i2--) {
      token = tokens[i2];
      if (token[1].toLowerCase() === "!important") {
        node2.important = true;
        let string = this.stringFrom(tokens, i2);
        string = this.spacesFromEnd(tokens) + string;
        if (string !== " !important") node2.raws.important = string;
        break;
      } else if (token[1].toLowerCase() === "important") {
        let cache = tokens.slice(0);
        let str = "";
        for (let j = i2; j > 0; j--) {
          let type = cache[j][0];
          if (str.trim().indexOf("!") === 0 && type !== "space") {
            break;
          }
          str = cache.pop()[1] + str;
        }
        if (str.trim().indexOf("!") === 0) {
          node2.important = true;
          node2.raws.important = str;
          tokens = cache;
        }
      }
      if (token[0] !== "space" && token[0] !== "comment") {
        break;
      }
    }
    let hasWord = tokens.some((i2) => i2[0] !== "space" && i2[0] !== "comment");
    if (hasWord) {
      node2.raws.between += firstSpaces.map((i2) => i2[1]).join("");
      firstSpaces = [];
    }
    this.raw(node2, "value", firstSpaces.concat(tokens), customProperty);
    if (node2.value.includes(":") && !customProperty) {
      this.checkMissedSemicolon(tokens);
    }
  }
  doubleColon(token) {
    throw this.input.error(
      "Double colon",
      { offset: token[2] },
      { offset: token[2] + token[1].length }
    );
  }
  emptyRule(token) {
    let node2 = new Rule$2$1();
    this.init(node2, token[2]);
    node2.selector = "";
    node2.raws.between = "";
    this.current = node2;
  }
  end(token) {
    if (this.current.nodes && this.current.nodes.length) {
      this.current.raws.semicolon = this.semicolon;
    }
    this.semicolon = false;
    this.current.raws.after = (this.current.raws.after || "") + this.spaces;
    this.spaces = "";
    if (this.current.parent) {
      this.current.source.end = this.getPosition(token[2]);
      this.current.source.end.offset++;
      this.current = this.current.parent;
    } else {
      this.unexpectedClose(token);
    }
  }
  endFile() {
    if (this.current.parent) this.unclosedBlock();
    if (this.current.nodes && this.current.nodes.length) {
      this.current.raws.semicolon = this.semicolon;
    }
    this.current.raws.after = (this.current.raws.after || "") + this.spaces;
    this.root.source.end = this.getPosition(this.tokenizer.position());
  }
  freeSemicolon(token) {
    this.spaces += token[1];
    if (this.current.nodes) {
      let prev = this.current.nodes[this.current.nodes.length - 1];
      if (prev && prev.type === "rule" && !prev.raws.ownSemicolon) {
        prev.raws.ownSemicolon = this.spaces;
        this.spaces = "";
      }
    }
  }
  // Helpers
  getPosition(offset) {
    let pos = this.input.fromOffset(offset);
    return {
      column: pos.col,
      line: pos.line,
      offset
    };
  }
  init(node2, offset) {
    this.current.push(node2);
    node2.source = {
      input: this.input,
      start: this.getPosition(offset)
    };
    node2.raws.before = this.spaces;
    this.spaces = "";
    if (node2.type !== "comment") this.semicolon = false;
  }
  other(start) {
    let end = false;
    let type = null;
    let colon = false;
    let bracket = null;
    let brackets = [];
    let customProperty = start[1].startsWith("--");
    let tokens = [];
    let token = start;
    while (token) {
      type = token[0];
      tokens.push(token);
      if (type === "(" || type === "[") {
        if (!bracket) bracket = token;
        brackets.push(type === "(" ? ")" : "]");
      } else if (customProperty && colon && type === "{") {
        if (!bracket) bracket = token;
        brackets.push("}");
      } else if (brackets.length === 0) {
        if (type === ";") {
          if (colon) {
            this.decl(tokens, customProperty);
            return;
          } else {
            break;
          }
        } else if (type === "{") {
          this.rule(tokens);
          return;
        } else if (type === "}") {
          this.tokenizer.back(tokens.pop());
          end = true;
          break;
        } else if (type === ":") {
          colon = true;
        }
      } else if (type === brackets[brackets.length - 1]) {
        brackets.pop();
        if (brackets.length === 0) bracket = null;
      }
      token = this.tokenizer.nextToken();
    }
    if (this.tokenizer.endOfFile()) end = true;
    if (brackets.length > 0) this.unclosedBracket(bracket);
    if (end && colon) {
      if (!customProperty) {
        while (tokens.length) {
          token = tokens[tokens.length - 1][0];
          if (token !== "space" && token !== "comment") break;
          this.tokenizer.back(tokens.pop());
        }
      }
      this.decl(tokens, customProperty);
    } else {
      this.unknownWord(tokens);
    }
  }
  parse() {
    let token;
    while (!this.tokenizer.endOfFile()) {
      token = this.tokenizer.nextToken();
      switch (token[0]) {
        case "space":
          this.spaces += token[1];
          break;
        case ";":
          this.freeSemicolon(token);
          break;
        case "}":
          this.end(token);
          break;
        case "comment":
          this.comment(token);
          break;
        case "at-word":
          this.atrule(token);
          break;
        case "{":
          this.emptyRule(token);
          break;
        default:
          this.other(token);
          break;
      }
    }
    this.endFile();
  }
  precheckMissedSemicolon() {
  }
  raw(node2, prop, tokens, customProperty) {
    let token, type;
    let length = tokens.length;
    let value = "";
    let clean = true;
    let next, prev;
    for (let i2 = 0; i2 < length; i2 += 1) {
      token = tokens[i2];
      type = token[0];
      if (type === "space" && i2 === length - 1 && !customProperty) {
        clean = false;
      } else if (type === "comment") {
        prev = tokens[i2 - 1] ? tokens[i2 - 1][0] : "empty";
        next = tokens[i2 + 1] ? tokens[i2 + 1][0] : "empty";
        if (!SAFE_COMMENT_NEIGHBOR$1[prev] && !SAFE_COMMENT_NEIGHBOR$1[next]) {
          if (value.slice(-1) === ",") {
            clean = false;
          } else {
            value += token[1];
          }
        } else {
          clean = false;
        }
      } else {
        value += token[1];
      }
    }
    if (!clean) {
      let raw = tokens.reduce((all, i2) => all + i2[1], "");
      node2.raws[prop] = { raw, value };
    }
    node2[prop] = value;
  }
  rule(tokens) {
    tokens.pop();
    let node2 = new Rule$2$1();
    this.init(node2, tokens[0][2]);
    node2.raws.between = this.spacesAndCommentsFromEnd(tokens);
    this.raw(node2, "selector", tokens);
    this.current = node2;
  }
  spacesAndCommentsFromEnd(tokens) {
    let lastTokenType;
    let spaces = "";
    while (tokens.length) {
      lastTokenType = tokens[tokens.length - 1][0];
      if (lastTokenType !== "space" && lastTokenType !== "comment") break;
      spaces = tokens.pop()[1] + spaces;
    }
    return spaces;
  }
  // Errors
  spacesAndCommentsFromStart(tokens) {
    let next;
    let spaces = "";
    while (tokens.length) {
      next = tokens[0][0];
      if (next !== "space" && next !== "comment") break;
      spaces += tokens.shift()[1];
    }
    return spaces;
  }
  spacesFromEnd(tokens) {
    let lastTokenType;
    let spaces = "";
    while (tokens.length) {
      lastTokenType = tokens[tokens.length - 1][0];
      if (lastTokenType !== "space") break;
      spaces = tokens.pop()[1] + spaces;
    }
    return spaces;
  }
  stringFrom(tokens, from) {
    let result2 = "";
    for (let i2 = from; i2 < tokens.length; i2++) {
      result2 += tokens[i2][1];
    }
    tokens.splice(from, tokens.length - from);
    return result2;
  }
  unclosedBlock() {
    let pos = this.current.source.start;
    throw this.input.error("Unclosed block", pos.line, pos.column);
  }
  unclosedBracket(bracket) {
    throw this.input.error(
      "Unclosed bracket",
      { offset: bracket[2] },
      { offset: bracket[2] + 1 }
    );
  }
  unexpectedClose(token) {
    throw this.input.error(
      "Unexpected }",
      { offset: token[2] },
      { offset: token[2] + 1 }
    );
  }
  unknownWord(tokens) {
    throw this.input.error(
      "Unknown word",
      { offset: tokens[0][2] },
      { offset: tokens[0][2] + tokens[0][1].length }
    );
  }
  unnamedAtrule(node2, token) {
    throw this.input.error(
      "At-rule without name",
      { offset: token[2] },
      { offset: token[2] + token[1].length }
    );
  }
};
var parser$1 = Parser$1$1;
let Container$2$1 = container$1;
let Parser2$1 = parser$1;
let Input$2$1 = input$1;
function parse$3$1(css, opts) {
  let input2 = new Input$2$1(css, opts);
  let parser2 = new Parser2$1(input2);
  try {
    parser2.parse();
  } catch (e2) {
    if (true) {
      if (e2.name === "CssSyntaxError" && opts && opts.from) {
        if (/\.scss$/i.test(opts.from)) {
          e2.message += "\nYou tried to parse SCSS with the standard CSS parser; try again with the postcss-scss parser";
        } else if (/\.sass/i.test(opts.from)) {
          e2.message += "\nYou tried to parse Sass with the standard CSS parser; try again with the postcss-sass parser";
        } else if (/\.less$/i.test(opts.from)) {
          e2.message += "\nYou tried to parse Less with the standard CSS parser; try again with the postcss-less parser";
        }
      }
    }
    throw e2;
  }
  return parser2.root;
}
var parse_1$1 = parse$3$1;
parse$3$1.default = parse$3$1;
Container$2$1.registerParse(parse$3$1);
let { isClean: isClean$3, my: my$3 } = symbols$1;
let MapGenerator$1$1 = mapGenerator$1;
let stringify$2$1 = stringify_1$1;
let Container$1$1 = container$1;
let Document$2$1 = document$1$1;
let warnOnce$1$1 = warnOnce$2$1;
let Result$2$1 = result$1;
let parse$2$1 = parse_1$1;
let Root$3$1 = root$1;
const TYPE_TO_CLASS_NAME$1 = {
  atrule: "AtRule",
  comment: "Comment",
  decl: "Declaration",
  document: "Document",
  root: "Root",
  rule: "Rule"
};
const PLUGIN_PROPS$1 = {
  AtRule: true,
  AtRuleExit: true,
  Comment: true,
  CommentExit: true,
  Declaration: true,
  DeclarationExit: true,
  Document: true,
  DocumentExit: true,
  Once: true,
  OnceExit: true,
  postcssPlugin: true,
  prepare: true,
  Root: true,
  RootExit: true,
  Rule: true,
  RuleExit: true
};
const NOT_VISITORS$1 = {
  Once: true,
  postcssPlugin: true,
  prepare: true
};
const CHILDREN$1 = 0;
function isPromise$1(obj) {
  return typeof obj === "object" && typeof obj.then === "function";
}
function getEvents$1(node2) {
  let key = false;
  let type = TYPE_TO_CLASS_NAME$1[node2.type];
  if (node2.type === "decl") {
    key = node2.prop.toLowerCase();
  } else if (node2.type === "atrule") {
    key = node2.name.toLowerCase();
  }
  if (key && node2.append) {
    return [
      type,
      type + "-" + key,
      CHILDREN$1,
      type + "Exit",
      type + "Exit-" + key
    ];
  } else if (key) {
    return [type, type + "-" + key, type + "Exit", type + "Exit-" + key];
  } else if (node2.append) {
    return [type, CHILDREN$1, type + "Exit"];
  } else {
    return [type, type + "Exit"];
  }
}
function toStack$1(node2) {
  let events;
  if (node2.type === "document") {
    events = ["Document", CHILDREN$1, "DocumentExit"];
  } else if (node2.type === "root") {
    events = ["Root", CHILDREN$1, "RootExit"];
  } else {
    events = getEvents$1(node2);
  }
  return {
    eventIndex: 0,
    events,
    iterator: 0,
    node: node2,
    visitorIndex: 0,
    visitors: []
  };
}
function cleanMarks$1(node2) {
  node2[isClean$3] = false;
  if (node2.nodes) node2.nodes.forEach((i2) => cleanMarks$1(i2));
  return node2;
}
let postcss$2$1 = {};
let LazyResult$2$1 = class LazyResult {
  constructor(processor2, css, opts) {
    this.stringified = false;
    this.processed = false;
    let root2;
    if (typeof css === "object" && css !== null && (css.type === "root" || css.type === "document")) {
      root2 = cleanMarks$1(css);
    } else if (css instanceof LazyResult || css instanceof Result$2$1) {
      root2 = cleanMarks$1(css.root);
      if (css.map) {
        if (typeof opts.map === "undefined") opts.map = {};
        if (!opts.map.inline) opts.map.inline = false;
        opts.map.prev = css.map;
      }
    } else {
      let parser2 = parse$2$1;
      if (opts.syntax) parser2 = opts.syntax.parse;
      if (opts.parser) parser2 = opts.parser;
      if (parser2.parse) parser2 = parser2.parse;
      try {
        root2 = parser2(css, opts);
      } catch (error) {
        this.processed = true;
        this.error = error;
      }
      if (root2 && !root2[my$3]) {
        Container$1$1.rebuild(root2);
      }
    }
    this.result = new Result$2$1(processor2, root2, opts);
    this.helpers = __spreadProps(__spreadValues({}, postcss$2$1), { postcss: postcss$2$1, result: this.result });
    this.plugins = this.processor.plugins.map((plugin22) => {
      if (typeof plugin22 === "object" && plugin22.prepare) {
        return __spreadValues(__spreadValues({}, plugin22), plugin22.prepare(this.result));
      } else {
        return plugin22;
      }
    });
  }
  async() {
    if (this.error) return Promise.reject(this.error);
    if (this.processed) return Promise.resolve(this.result);
    if (!this.processing) {
      this.processing = this.runAsync();
    }
    return this.processing;
  }
  catch(onRejected) {
    return this.async().catch(onRejected);
  }
  finally(onFinally) {
    return this.async().then(onFinally, onFinally);
  }
  getAsyncError() {
    throw new Error("Use process(css).then(cb) to work with async plugins");
  }
  handleError(error, node2) {
    let plugin22 = this.result.lastPlugin;
    try {
      if (node2) node2.addToError(error);
      this.error = error;
      if (error.name === "CssSyntaxError" && !error.plugin) {
        error.plugin = plugin22.postcssPlugin;
        error.setMessage();
      } else if (plugin22.postcssVersion) {
        if (true) {
          let pluginName = plugin22.postcssPlugin;
          let pluginVer = plugin22.postcssVersion;
          let runtimeVer = this.result.processor.version;
          let a2 = pluginVer.split(".");
          let b = runtimeVer.split(".");
          if (a2[0] !== b[0] || parseInt(a2[1]) > parseInt(b[1])) {
            console.error(
              "Unknown error from PostCSS plugin. Your current PostCSS version is " + runtimeVer + ", but " + pluginName + " uses " + pluginVer + ". Perhaps this is the source of the error below."
            );
          }
        }
      }
    } catch (err) {
      if (console && console.error) console.error(err);
    }
    return error;
  }
  prepareVisitors() {
    this.listeners = {};
    let add = (plugin22, type, cb) => {
      if (!this.listeners[type]) this.listeners[type] = [];
      this.listeners[type].push([plugin22, cb]);
    };
    for (let plugin22 of this.plugins) {
      if (typeof plugin22 === "object") {
        for (let event in plugin22) {
          if (!PLUGIN_PROPS$1[event] && /^[A-Z]/.test(event)) {
            throw new Error(
              `Unknown event ${event} in ${plugin22.postcssPlugin}. Try to update PostCSS (${this.processor.version} now).`
            );
          }
          if (!NOT_VISITORS$1[event]) {
            if (typeof plugin22[event] === "object") {
              for (let filter in plugin22[event]) {
                if (filter === "*") {
                  add(plugin22, event, plugin22[event][filter]);
                } else {
                  add(
                    plugin22,
                    event + "-" + filter.toLowerCase(),
                    plugin22[event][filter]
                  );
                }
              }
            } else if (typeof plugin22[event] === "function") {
              add(plugin22, event, plugin22[event]);
            }
          }
        }
      }
    }
    this.hasListener = Object.keys(this.listeners).length > 0;
  }
  async runAsync() {
    this.plugin = 0;
    for (let i2 = 0; i2 < this.plugins.length; i2++) {
      let plugin22 = this.plugins[i2];
      let promise = this.runOnRoot(plugin22);
      if (isPromise$1(promise)) {
        try {
          await promise;
        } catch (error) {
          throw this.handleError(error);
        }
      }
    }
    this.prepareVisitors();
    if (this.hasListener) {
      let root2 = this.result.root;
      while (!root2[isClean$3]) {
        root2[isClean$3] = true;
        let stack = [toStack$1(root2)];
        while (stack.length > 0) {
          let promise = this.visitTick(stack);
          if (isPromise$1(promise)) {
            try {
              await promise;
            } catch (e2) {
              let node2 = stack[stack.length - 1].node;
              throw this.handleError(e2, node2);
            }
          }
        }
      }
      if (this.listeners.OnceExit) {
        for (let [plugin22, visitor] of this.listeners.OnceExit) {
          this.result.lastPlugin = plugin22;
          try {
            if (root2.type === "document") {
              let roots = root2.nodes.map(
                (subRoot) => visitor(subRoot, this.helpers)
              );
              await Promise.all(roots);
            } else {
              await visitor(root2, this.helpers);
            }
          } catch (e2) {
            throw this.handleError(e2);
          }
        }
      }
    }
    this.processed = true;
    return this.stringify();
  }
  runOnRoot(plugin22) {
    this.result.lastPlugin = plugin22;
    try {
      if (typeof plugin22 === "object" && plugin22.Once) {
        if (this.result.root.type === "document") {
          let roots = this.result.root.nodes.map(
            (root2) => plugin22.Once(root2, this.helpers)
          );
          if (isPromise$1(roots[0])) {
            return Promise.all(roots);
          }
          return roots;
        }
        return plugin22.Once(this.result.root, this.helpers);
      } else if (typeof plugin22 === "function") {
        return plugin22(this.result.root, this.result);
      }
    } catch (error) {
      throw this.handleError(error);
    }
  }
  stringify() {
    if (this.error) throw this.error;
    if (this.stringified) return this.result;
    this.stringified = true;
    this.sync();
    let opts = this.result.opts;
    let str = stringify$2$1;
    if (opts.syntax) str = opts.syntax.stringify;
    if (opts.stringifier) str = opts.stringifier;
    if (str.stringify) str = str.stringify;
    let map = new MapGenerator$1$1(str, this.result.root, this.result.opts);
    let data = map.generate();
    this.result.css = data[0];
    this.result.map = data[1];
    return this.result;
  }
  sync() {
    if (this.error) throw this.error;
    if (this.processed) return this.result;
    this.processed = true;
    if (this.processing) {
      throw this.getAsyncError();
    }
    for (let plugin22 of this.plugins) {
      let promise = this.runOnRoot(plugin22);
      if (isPromise$1(promise)) {
        throw this.getAsyncError();
      }
    }
    this.prepareVisitors();
    if (this.hasListener) {
      let root2 = this.result.root;
      while (!root2[isClean$3]) {
        root2[isClean$3] = true;
        this.walkSync(root2);
      }
      if (this.listeners.OnceExit) {
        if (root2.type === "document") {
          for (let subRoot of root2.nodes) {
            this.visitSync(this.listeners.OnceExit, subRoot);
          }
        } else {
          this.visitSync(this.listeners.OnceExit, root2);
        }
      }
    }
    return this.result;
  }
  then(onFulfilled, onRejected) {
    if (true) {
      if (!("from" in this.opts)) {
        warnOnce$1$1(
          "Without `from` option PostCSS could generate wrong source map and will not find Browserslist config. Set it to CSS file path or to `undefined` to prevent this warning."
        );
      }
    }
    return this.async().then(onFulfilled, onRejected);
  }
  toString() {
    return this.css;
  }
  visitSync(visitors, node2) {
    for (let [plugin22, visitor] of visitors) {
      this.result.lastPlugin = plugin22;
      let promise;
      try {
        promise = visitor(node2, this.helpers);
      } catch (e2) {
        throw this.handleError(e2, node2.proxyOf);
      }
      if (node2.type !== "root" && node2.type !== "document" && !node2.parent) {
        return true;
      }
      if (isPromise$1(promise)) {
        throw this.getAsyncError();
      }
    }
  }
  visitTick(stack) {
    let visit2 = stack[stack.length - 1];
    let { node: node2, visitors } = visit2;
    if (node2.type !== "root" && node2.type !== "document" && !node2.parent) {
      stack.pop();
      return;
    }
    if (visitors.length > 0 && visit2.visitorIndex < visitors.length) {
      let [plugin22, visitor] = visitors[visit2.visitorIndex];
      visit2.visitorIndex += 1;
      if (visit2.visitorIndex === visitors.length) {
        visit2.visitors = [];
        visit2.visitorIndex = 0;
      }
      this.result.lastPlugin = plugin22;
      try {
        return visitor(node2.toProxy(), this.helpers);
      } catch (e2) {
        throw this.handleError(e2, node2);
      }
    }
    if (visit2.iterator !== 0) {
      let iterator = visit2.iterator;
      let child;
      while (child = node2.nodes[node2.indexes[iterator]]) {
        node2.indexes[iterator] += 1;
        if (!child[isClean$3]) {
          child[isClean$3] = true;
          stack.push(toStack$1(child));
          return;
        }
      }
      visit2.iterator = 0;
      delete node2.indexes[iterator];
    }
    let events = visit2.events;
    while (visit2.eventIndex < events.length) {
      let event = events[visit2.eventIndex];
      visit2.eventIndex += 1;
      if (event === CHILDREN$1) {
        if (node2.nodes && node2.nodes.length) {
          node2[isClean$3] = true;
          visit2.iterator = node2.getIterator();
        }
        return;
      } else if (this.listeners[event]) {
        visit2.visitors = this.listeners[event];
        return;
      }
    }
    stack.pop();
  }
  walkSync(node2) {
    node2[isClean$3] = true;
    let events = getEvents$1(node2);
    for (let event of events) {
      if (event === CHILDREN$1) {
        if (node2.nodes) {
          node2.each((child) => {
            if (!child[isClean$3]) this.walkSync(child);
          });
        }
      } else {
        let visitors = this.listeners[event];
        if (visitors) {
          if (this.visitSync(visitors, node2.toProxy())) return;
        }
      }
    }
  }
  warnings() {
    return this.sync().warnings();
  }
  get content() {
    return this.stringify().content;
  }
  get css() {
    return this.stringify().css;
  }
  get map() {
    return this.stringify().map;
  }
  get messages() {
    return this.sync().messages;
  }
  get opts() {
    return this.result.opts;
  }
  get processor() {
    return this.result.processor;
  }
  get root() {
    return this.sync().root;
  }
  get [Symbol.toStringTag]() {
    return "LazyResult";
  }
};
LazyResult$2$1.registerPostcss = (dependant) => {
  postcss$2$1 = dependant;
};
var lazyResult$1 = LazyResult$2$1;
LazyResult$2$1.default = LazyResult$2$1;
Root$3$1.registerLazyResult(LazyResult$2$1);
Document$2$1.registerLazyResult(LazyResult$2$1);
let MapGenerator2$1 = mapGenerator$1;
let stringify$1$1 = stringify_1$1;
let warnOnce2$1 = warnOnce$2$1;
let parse$1$1 = parse_1$1;
const Result$1$1 = result$1;
let NoWorkResult$1$1 = class NoWorkResult {
  constructor(processor2, css, opts) {
    css = css.toString();
    this.stringified = false;
    this._processor = processor2;
    this._css = css;
    this._opts = opts;
    this._map = void 0;
    let root2;
    let str = stringify$1$1;
    this.result = new Result$1$1(this._processor, root2, this._opts);
    this.result.css = css;
    let self = this;
    Object.defineProperty(this.result, "root", {
      get() {
        return self.root;
      }
    });
    let map = new MapGenerator2$1(str, root2, this._opts, css);
    if (map.isMap()) {
      let [generatedCSS, generatedMap] = map.generate();
      if (generatedCSS) {
        this.result.css = generatedCSS;
      }
      if (generatedMap) {
        this.result.map = generatedMap;
      }
    } else {
      map.clearAnnotation();
      this.result.css = map.css;
    }
  }
  async() {
    if (this.error) return Promise.reject(this.error);
    return Promise.resolve(this.result);
  }
  catch(onRejected) {
    return this.async().catch(onRejected);
  }
  finally(onFinally) {
    return this.async().then(onFinally, onFinally);
  }
  sync() {
    if (this.error) throw this.error;
    return this.result;
  }
  then(onFulfilled, onRejected) {
    if (true) {
      if (!("from" in this._opts)) {
        warnOnce2$1(
          "Without `from` option PostCSS could generate wrong source map and will not find Browserslist config. Set it to CSS file path or to `undefined` to prevent this warning."
        );
      }
    }
    return this.async().then(onFulfilled, onRejected);
  }
  toString() {
    return this._css;
  }
  warnings() {
    return [];
  }
  get content() {
    return this.result.css;
  }
  get css() {
    return this.result.css;
  }
  get map() {
    return this.result.map;
  }
  get messages() {
    return [];
  }
  get opts() {
    return this.result.opts;
  }
  get processor() {
    return this.result.processor;
  }
  get root() {
    if (this._root) {
      return this._root;
    }
    let root2;
    let parser2 = parse$1$1;
    try {
      root2 = parser2(this._css, this._opts);
    } catch (error) {
      this.error = error;
    }
    if (this.error) {
      throw this.error;
    } else {
      this._root = root2;
      return root2;
    }
  }
  get [Symbol.toStringTag]() {
    return "NoWorkResult";
  }
};
var noWorkResult$1 = NoWorkResult$1$1;
NoWorkResult$1$1.default = NoWorkResult$1$1;
let NoWorkResult2$1 = noWorkResult$1;
let LazyResult$1$1 = lazyResult$1;
let Document$1$1 = document$1$1;
let Root$2$1 = root$1;
let Processor$1$1 = class Processor {
  constructor(plugins = []) {
    this.version = "8.4.38";
    this.plugins = this.normalize(plugins);
  }
  normalize(plugins) {
    let normalized = [];
    for (let i2 of plugins) {
      if (i2.postcss === true) {
        i2 = i2();
      } else if (i2.postcss) {
        i2 = i2.postcss;
      }
      if (typeof i2 === "object" && Array.isArray(i2.plugins)) {
        normalized = normalized.concat(i2.plugins);
      } else if (typeof i2 === "object" && i2.postcssPlugin) {
        normalized.push(i2);
      } else if (typeof i2 === "function") {
        normalized.push(i2);
      } else if (typeof i2 === "object" && (i2.parse || i2.stringify)) {
        if (true) {
          throw new Error(
            "PostCSS syntaxes cannot be used as plugins. Instead, please use one of the syntax/parser/stringifier options as outlined in your PostCSS runner documentation."
          );
        }
      } else {
        throw new Error(i2 + " is not a PostCSS plugin");
      }
    }
    return normalized;
  }
  process(css, opts = {}) {
    if (!this.plugins.length && !opts.parser && !opts.stringifier && !opts.syntax) {
      return new NoWorkResult2$1(this, css, opts);
    } else {
      return new LazyResult$1$1(this, css, opts);
    }
  }
  use(plugin22) {
    this.plugins = this.plugins.concat(this.normalize([plugin22]));
    return this;
  }
};
var processor$1 = Processor$1$1;
Processor$1$1.default = Processor$1$1;
Root$2$1.registerProcessor(Processor$1$1);
Document$1$1.registerProcessor(Processor$1$1);
let Declaration$1$1 = declaration$1;
let PreviousMap2$1 = previousMap$1;
let Comment$1$1 = comment$1;
let AtRule$1$1 = atRule$1;
let Input$1$1 = input$1;
let Root$1$1 = root$1;
let Rule$1$1 = rule$1;
function fromJSON$1$1(json, inputs) {
  if (Array.isArray(json)) return json.map((n2) => fromJSON$1$1(n2));
  let _a2 = json, { inputs: ownInputs } = _a2, defaults = __objRest(_a2, ["inputs"]);
  if (ownInputs) {
    inputs = [];
    for (let input2 of ownInputs) {
      let inputHydrated = __spreadProps(__spreadValues({}, input2), { __proto__: Input$1$1.prototype });
      if (inputHydrated.map) {
        inputHydrated.map = __spreadProps(__spreadValues({}, inputHydrated.map), {
          __proto__: PreviousMap2$1.prototype
        });
      }
      inputs.push(inputHydrated);
    }
  }
  if (defaults.nodes) {
    defaults.nodes = json.nodes.map((n2) => fromJSON$1$1(n2, inputs));
  }
  if (defaults.source) {
    let _b2 = defaults.source, { inputId } = _b2, source = __objRest(_b2, ["inputId"]);
    defaults.source = source;
    if (inputId != null) {
      defaults.source.input = inputs[inputId];
    }
  }
  if (defaults.type === "root") {
    return new Root$1$1(defaults);
  } else if (defaults.type === "decl") {
    return new Declaration$1$1(defaults);
  } else if (defaults.type === "rule") {
    return new Rule$1$1(defaults);
  } else if (defaults.type === "comment") {
    return new Comment$1$1(defaults);
  } else if (defaults.type === "atrule") {
    return new AtRule$1$1(defaults);
  } else {
    throw new Error("Unknown node type: " + json.type);
  }
}
var fromJSON_1$1 = fromJSON$1$1;
fromJSON$1$1.default = fromJSON$1$1;
let CssSyntaxError2$1 = cssSyntaxError$1;
let Declaration2$1 = declaration$1;
let LazyResult2$1 = lazyResult$1;
let Container2$1 = container$1;
let Processor2$1 = processor$1;
let stringify$5 = stringify_1$1;
let fromJSON$2 = fromJSON_1$1;
let Document22 = document$1$1;
let Warning2$1 = warning$1;
let Comment2$1 = comment$1;
let AtRule2$1 = atRule$1;
let Result2$1 = result$1;
let Input2$1 = input$1;
let parse$5 = parse_1$1;
let list$3 = list_1$1;
let Rule2$1 = rule$1;
let Root2$1 = root$1;
let Node2$1 = node$1;
function postcss$3(...plugins) {
  if (plugins.length === 1 && Array.isArray(plugins[0])) {
    plugins = plugins[0];
  }
  return new Processor2$1(plugins);
}
postcss$3.plugin = function plugin(name, initializer) {
  let warningPrinted = false;
  function creator(...args) {
    if (console && console.warn && !warningPrinted) {
      warningPrinted = true;
      console.warn(
        name + ": postcss.plugin was deprecated. Migration guide:\nhttps://evilmartians.com/chronicles/postcss-8-plugin-migration"
      );
      if (process.env.LANG && process.env.LANG.startsWith("cn")) {
        console.warn(
          name + ": \u91CC\u9762 postcss.plugin \u88AB\u5F03\u7528. \u8FC1\u79FB\u6307\u5357:\nhttps://www.w3ctech.com/topic/2226"
        );
      }
    }
    let transformer = initializer(...args);
    transformer.postcssPlugin = name;
    transformer.postcssVersion = new Processor2$1().version;
    return transformer;
  }
  let cache;
  Object.defineProperty(creator, "postcss", {
    get() {
      if (!cache) cache = creator();
      return cache;
    }
  });
  creator.process = function(css, processOpts, pluginOpts) {
    return postcss$3([creator(pluginOpts)]).process(css, processOpts);
  };
  return creator;
};
postcss$3.stringify = stringify$5;
postcss$3.parse = parse$5;
postcss$3.fromJSON = fromJSON$2;
postcss$3.list = list$3;
postcss$3.comment = (defaults) => new Comment2$1(defaults);
postcss$3.atRule = (defaults) => new AtRule2$1(defaults);
postcss$3.decl = (defaults) => new Declaration2$1(defaults);
postcss$3.rule = (defaults) => new Rule2$1(defaults);
postcss$3.root = (defaults) => new Root2$1(defaults);
postcss$3.document = (defaults) => new Document22(defaults);
postcss$3.CssSyntaxError = CssSyntaxError2$1;
postcss$3.Declaration = Declaration2$1;
postcss$3.Container = Container2$1;
postcss$3.Processor = Processor2$1;
postcss$3.Document = Document22;
postcss$3.Comment = Comment2$1;
postcss$3.Warning = Warning2$1;
postcss$3.AtRule = AtRule2$1;
postcss$3.Result = Result2$1;
postcss$3.Input = Input2$1;
postcss$3.Rule = Rule2$1;
postcss$3.Root = Root2$1;
postcss$3.Node = Node2$1;
LazyResult2$1.registerPostcss(postcss$3);
var postcss_1$1 = postcss$3;
postcss$3.default = postcss$3;
const postcss$1$1 = /* @__PURE__ */ getDefaultExportFromCjs$1(postcss_1$1);
postcss$1$1.stringify;
postcss$1$1.fromJSON;
postcss$1$1.plugin;
postcss$1$1.parse;
postcss$1$1.list;
postcss$1$1.document;
postcss$1$1.comment;
postcss$1$1.atRule;
postcss$1$1.rule;
postcss$1$1.decl;
postcss$1$1.root;
postcss$1$1.CssSyntaxError;
postcss$1$1.Declaration;
postcss$1$1.Container;
postcss$1$1.Processor;
postcss$1$1.Document;
postcss$1$1.Comment;
postcss$1$1.Warning;
postcss$1$1.AtRule;
postcss$1$1.Result;
postcss$1$1.Input;
postcss$1$1.Rule;
postcss$1$1.Root;
postcss$1$1.Node;
const tagMap = {
  script: "noscript",
  // camel case svg element tag names
  altglyph: "altGlyph",
  altglyphdef: "altGlyphDef",
  altglyphitem: "altGlyphItem",
  animatecolor: "animateColor",
  animatemotion: "animateMotion",
  animatetransform: "animateTransform",
  clippath: "clipPath",
  feblend: "feBlend",
  fecolormatrix: "feColorMatrix",
  fecomponenttransfer: "feComponentTransfer",
  fecomposite: "feComposite",
  feconvolvematrix: "feConvolveMatrix",
  fediffuselighting: "feDiffuseLighting",
  fedisplacementmap: "feDisplacementMap",
  fedistantlight: "feDistantLight",
  fedropshadow: "feDropShadow",
  feflood: "feFlood",
  fefunca: "feFuncA",
  fefuncb: "feFuncB",
  fefuncg: "feFuncG",
  fefuncr: "feFuncR",
  fegaussianblur: "feGaussianBlur",
  feimage: "feImage",
  femerge: "feMerge",
  femergenode: "feMergeNode",
  femorphology: "feMorphology",
  feoffset: "feOffset",
  fepointlight: "fePointLight",
  fespecularlighting: "feSpecularLighting",
  fespotlight: "feSpotLight",
  fetile: "feTile",
  feturbulence: "feTurbulence",
  foreignobject: "foreignObject",
  glyphref: "glyphRef",
  lineargradient: "linearGradient",
  radialgradient: "radialGradient"
};
function getTagName(n2) {
  let tagName = tagMap[n2.tagName] ? tagMap[n2.tagName] : n2.tagName;
  if (tagName === "link" && n2.attributes._cssText) {
    tagName = "style";
  }
  return tagName;
}
function adaptCssForReplay(cssText, cache) {
  const cachedStyle = cache == null ? void 0 : cache.stylesWithHoverClass.get(cssText);
  if (cachedStyle) return cachedStyle;
  let result2 = cssText;
  try {
    const ast = postcss$1$1([
      mediaSelectorPlugin,
      pseudoClassPlugin
    ]).process(cssText);
    result2 = ast.css;
  } catch (error) {
    console.warn("Failed to adapt css for replay", error);
  }
  cache == null ? void 0 : cache.stylesWithHoverClass.set(cssText, result2);
  return result2;
}
function createCache() {
  const stylesWithHoverClass = /* @__PURE__ */ new Map();
  return {
    stylesWithHoverClass
  };
}
function applyCssSplits(n2, cssText, hackCss, cache) {
  const childTextNodes = [];
  for (const scn of n2.childNodes) {
    if (scn.type === NodeType$3.Text) {
      childTextNodes.push(scn);
    }
  }
  const cssTextSplits = cssText.split("/* rr_split */");
  while (cssTextSplits.length > 1 && cssTextSplits.length > childTextNodes.length) {
    cssTextSplits.splice(-2, 2, cssTextSplits.slice(-2).join(""));
  }
  let adaptedCss = "";
  if (hackCss) {
    adaptedCss = adaptCssForReplay(cssTextSplits.join(""), cache);
  }
  let startIndex = 0;
  for (let i2 = 0; i2 < childTextNodes.length; i2++) {
    if (i2 === cssTextSplits.length) {
      break;
    }
    const childTextNode = childTextNodes[i2];
    if (!hackCss) {
      childTextNode.textContent = cssTextSplits[i2];
    } else if (i2 < cssTextSplits.length - 1) {
      let endIndex = startIndex;
      let endSearch = cssTextSplits[i2 + 1].length;
      endSearch = Math.min(endSearch, 30);
      let found = false;
      for (; endSearch > 2; endSearch--) {
        const searchBit = cssTextSplits[i2 + 1].substring(0, endSearch);
        const searchIndex = adaptedCss.substring(startIndex).indexOf(searchBit);
        found = searchIndex !== -1;
        if (found) {
          endIndex += searchIndex;
          break;
        }
      }
      if (!found) {
        endIndex += cssTextSplits[i2].length;
      }
      childTextNode.textContent = adaptedCss.substring(startIndex, endIndex);
      startIndex = endIndex;
    } else {
      childTextNode.textContent = adaptedCss.substring(startIndex);
    }
  }
}
function buildStyleNode(n2, styleEl, cssText, options) {
  const { doc, hackCss, cache } = options;
  if (n2.childNodes.length) {
    applyCssSplits(n2, cssText, hackCss, cache);
  } else {
    if (hackCss) {
      cssText = adaptCssForReplay(cssText, cache);
    }
    styleEl.appendChild(doc.createTextNode(cssText));
  }
}
function buildNode(n2, options) {
  var _a2;
  const { doc, hackCss, cache } = options;
  switch (n2.type) {
    case NodeType$3.Document:
      return doc.implementation.createDocument(null, "", null);
    case NodeType$3.DocumentType:
      return doc.implementation.createDocumentType(
        n2.name || "html",
        n2.publicId,
        n2.systemId
      );
    case NodeType$3.Element: {
      const tagName = getTagName(n2);
      let node2;
      if (n2.isSVG) {
        node2 = doc.createElementNS("http://www.w3.org/2000/svg", tagName);
      } else {
        if (
          // If the tag name is a custom element name
          n2.isCustom && // If the browser supports custom elements
          ((_a2 = doc.defaultView) == null ? void 0 : _a2.customElements) && // If the custom element hasn't been defined yet
          !doc.defaultView.customElements.get(n2.tagName)
        )
          doc.defaultView.customElements.define(
            n2.tagName,
            class extends doc.defaultView.HTMLElement {
            }
          );
        node2 = doc.createElement(tagName);
      }
      const specialAttributes = {};
      for (const name in n2.attributes) {
        if (!Object.prototype.hasOwnProperty.call(n2.attributes, name)) {
          continue;
        }
        let value = n2.attributes[name];
        if (tagName === "option" && name === "selected" && value === false) {
          continue;
        }
        if (value === null) {
          continue;
        }
        if (value === true) value = "";
        if (name.startsWith("rr_")) {
          specialAttributes[name] = value;
          continue;
        }
        if (typeof value !== "string") ;
        else if (tagName === "style" && name === "_cssText") {
          buildStyleNode(n2, node2, value, options);
          continue;
        } else if (tagName === "textarea" && name === "value") {
          node2.appendChild(doc.createTextNode(value));
          n2.childNodes = [];
          continue;
        }
        try {
          if (n2.isSVG && name === "xlink:href") {
            node2.setAttributeNS(
              "http://www.w3.org/1999/xlink",
              name,
              value.toString()
            );
          } else if (name === "onload" || name === "onclick" || name.substring(0, 7) === "onmouse") {
            node2.setAttribute("_" + name, value.toString());
          } else if (tagName === "meta" && n2.attributes["http-equiv"] === "Content-Security-Policy" && name === "content") {
            node2.setAttribute("csp-content", value.toString());
            continue;
          } else if (tagName === "link" && (n2.attributes.rel === "preload" && n2.attributes.as === "script" || n2.attributes.rel === "modulepreload")) {
          } else if (tagName === "link" && n2.attributes.rel === "prefetch" && typeof n2.attributes.href === "string" && extractFileExtension(n2.attributes.href) === "js") {
          } else if (tagName === "img" && n2.attributes.srcset && n2.attributes.rr_dataURL) {
            node2.setAttribute(
              "rrweb-original-srcset",
              n2.attributes.srcset
            );
          } else {
            node2.setAttribute(name, value.toString());
          }
        } catch (error) {
        }
      }
      for (const name in specialAttributes) {
        const value = specialAttributes[name];
        if (tagName === "canvas" && name === "rr_dataURL") {
          const image = doc.createElement("img");
          image.onload = () => {
            const ctx = node2.getContext("2d");
            if (ctx) {
              ctx.drawImage(image, 0, 0, image.width, image.height);
            }
          };
          image.src = value.toString();
          if (node2.RRNodeType)
            node2.rr_dataURL = value.toString();
        } else if (tagName === "img" && name === "rr_dataURL") {
          const image = node2;
          if (!image.currentSrc.startsWith("data:")) {
            image.setAttribute(
              "rrweb-original-src",
              n2.attributes.src
            );
            image.src = value.toString();
          }
        }
        if (name === "rr_width") {
          node2.style.setProperty("width", value.toString());
        } else if (name === "rr_height") {
          node2.style.setProperty("height", value.toString());
        } else if (name === "rr_mediaCurrentTime" && typeof value === "number") {
          node2.currentTime = value;
        } else if (name === "rr_mediaState") {
          switch (value) {
            case "played":
              node2.play().catch((e2) => console.warn("media playback error", e2));
              break;
            case "paused":
              node2.pause();
              break;
          }
        } else if (name === "rr_mediaPlaybackRate" && typeof value === "number") {
          node2.playbackRate = value;
        } else if (name === "rr_mediaMuted" && typeof value === "boolean") {
          node2.muted = value;
        } else if (name === "rr_mediaLoop" && typeof value === "boolean") {
          node2.loop = value;
        } else if (name === "rr_mediaVolume" && typeof value === "number") {
          node2.volume = value;
        } else if (name === "rr_open_mode") {
          node2.setAttribute(
            "rr_open_mode",
            value
          );
        }
      }
      if (n2.isShadowHost) {
        if (!node2.shadowRoot) {
          node2.attachShadow({ mode: "open" });
        } else {
          while (node2.shadowRoot.firstChild) {
            node2.shadowRoot.removeChild(node2.shadowRoot.firstChild);
          }
        }
      }
      return node2;
    }
    case NodeType$3.Text:
      if (n2.isStyle && hackCss) {
        return doc.createTextNode(adaptCssForReplay(n2.textContent, cache));
      }
      return doc.createTextNode(n2.textContent);
    case NodeType$3.CDATA:
      return doc.createCDATASection(n2.textContent);
    case NodeType$3.Comment:
      return doc.createComment(n2.textContent);
    default:
      return null;
  }
}
function buildNodeWithSN(n2, options) {
  const {
    doc,
    mirror: mirror2,
    skipChild = false,
    hackCss = true,
    afterAppend,
    cache
  } = options;
  if (mirror2.has(n2.id)) {
    const nodeInMirror = mirror2.getNode(n2.id);
    const meta = mirror2.getMeta(nodeInMirror);
    if (isNodeMetaEqual(meta, n2)) return mirror2.getNode(n2.id);
  }
  let node2 = buildNode(n2, { doc, hackCss, cache });
  if (!node2) {
    return null;
  }
  if (n2.rootId && mirror2.getNode(n2.rootId) !== doc) {
    mirror2.replace(n2.rootId, doc);
  }
  if (n2.type === NodeType$3.Document) {
    doc.close();
    doc.open();
    if (n2.compatMode === "BackCompat" && n2.childNodes && n2.childNodes[0].type !== NodeType$3.DocumentType) {
      if (n2.childNodes[0].type === NodeType$3.Element && "xmlns" in n2.childNodes[0].attributes && n2.childNodes[0].attributes.xmlns === "http://www.w3.org/1999/xhtml") {
        doc.write(
          '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "">'
        );
      } else {
        doc.write(
          '<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.0 Transitional//EN" "">'
        );
      }
    }
    node2 = doc;
  }
  mirror2.add(node2, n2);
  if ((n2.type === NodeType$3.Document || n2.type === NodeType$3.Element) && !skipChild) {
    for (const childN of n2.childNodes) {
      const childNode = buildNodeWithSN(childN, {
        doc,
        mirror: mirror2,
        skipChild: false,
        hackCss,
        afterAppend,
        cache
      });
      if (!childNode) {
        console.warn("Failed to rebuild", childN);
        continue;
      }
      if (childN.isShadow && isElement(node2) && node2.shadowRoot) {
        node2.shadowRoot.appendChild(childNode);
      } else if (n2.type === NodeType$3.Document && childN.type == NodeType$3.Element) {
        const htmlElement = childNode;
        let body = null;
        htmlElement.childNodes.forEach((child) => {
          if (child.nodeName === "BODY") body = child;
        });
        if (body) {
          htmlElement.removeChild(body);
          node2.appendChild(childNode);
          htmlElement.appendChild(body);
        } else {
          node2.appendChild(childNode);
        }
      } else {
        node2.appendChild(childNode);
      }
      if (afterAppend) {
        afterAppend(childNode, childN.id);
      }
    }
  }
  return node2;
}
function visit(mirror2, onVisit) {
  function walk(node2) {
    onVisit(node2);
  }
  for (const id of mirror2.getIds()) {
    if (mirror2.has(id)) {
      walk(mirror2.getNode(id));
    }
  }
}
function handleScroll(node2, mirror2) {
  const n2 = mirror2.getMeta(node2);
  if ((n2 == null ? void 0 : n2.type) !== NodeType$3.Element) {
    return;
  }
  const el = node2;
  for (const name in n2.attributes) {
    if (!(Object.prototype.hasOwnProperty.call(n2.attributes, name) && name.startsWith("rr_"))) {
      continue;
    }
    const value = n2.attributes[name];
    if (name === "rr_scrollLeft") {
      el.scrollLeft = value;
    }
    if (name === "rr_scrollTop") {
      el.scrollTop = value;
    }
  }
}
function rebuild(n2, options) {
  const {
    doc,
    onVisit,
    hackCss = true,
    afterAppend,
    cache,
    mirror: mirror2 = new Mirror()
  } = options;
  const node2 = buildNodeWithSN(n2, {
    doc,
    mirror: mirror2,
    skipChild: false,
    hackCss,
    afterAppend,
    cache
  });
  visit(mirror2, (visitedNode) => {
    if (onVisit) {
      onVisit(visitedNode);
    }
    handleScroll(visitedNode, mirror2);
  });
  return node2;
}
var __defProp222 = Object.defineProperty;
var __defNormalProp222 = (obj, key, value) => key in obj ? __defProp222(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField22 = (obj, key, value) => __defNormalProp222(obj, typeof key !== "symbol" ? key + "" : key, value);
var __defProp2222 = Object.defineProperty;
var __defNormalProp2222 = (obj, key, value) => key in obj ? __defProp2222(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField222 = (obj, key, value) => __defNormalProp2222(obj, typeof key !== "symbol" ? key + "" : key, value);
let Mirror$1 = class Mirror2 {
  constructor() {
    __publicField222(this, "idNodeMap", /* @__PURE__ */ new Map());
    __publicField222(this, "nodeMetaMap", /* @__PURE__ */ new WeakMap());
  }
  getId(n2) {
    var _a2;
    if (!n2) return -1;
    const id = (_a2 = this.getMeta(n2)) == null ? void 0 : _a2.id;
    return id != null ? id : -1;
  }
  getNode(id) {
    return this.idNodeMap.get(id) || null;
  }
  getIds() {
    return Array.from(this.idNodeMap.keys());
  }
  getMeta(n2) {
    return this.nodeMetaMap.get(n2) || null;
  }
  // removes the node from idNodeMap
  // doesn't remove the node from nodeMetaMap
  removeNodeFromMap(n2) {
    const id = this.getId(n2);
    this.idNodeMap.delete(id);
    if (n2.childNodes) {
      n2.childNodes.forEach(
        (childNode) => this.removeNodeFromMap(childNode)
      );
    }
  }
  has(id) {
    return this.idNodeMap.has(id);
  }
  hasNode(node2) {
    return this.nodeMetaMap.has(node2);
  }
  add(n2, meta) {
    const id = meta.id;
    this.idNodeMap.set(id, n2);
    this.nodeMetaMap.set(n2, meta);
  }
  replace(id, n2) {
    const oldNode = this.getNode(id);
    if (oldNode) {
      const meta = this.nodeMetaMap.get(oldNode);
      if (meta) this.nodeMetaMap.set(n2, meta);
    }
    this.idNodeMap.set(id, n2);
  }
  reset() {
    this.idNodeMap = /* @__PURE__ */ new Map();
    this.nodeMetaMap = /* @__PURE__ */ new WeakMap();
  }
};
function createMirror$1() {
  return new Mirror$1();
}
function getDefaultExportFromCjs(x2) {
  return x2 && x2.__esModule && Object.prototype.hasOwnProperty.call(x2, "default") ? x2["default"] : x2;
}
function getAugmentedNamespace(n2) {
  if (n2.__esModule) return n2;
  var f2 = n2.default;
  if (typeof f2 == "function") {
    var a2 = function a22() {
      if (this instanceof a22) {
        return Reflect.construct(f2, arguments, this.constructor);
      }
      return f2.apply(this, arguments);
    };
    a2.prototype = f2.prototype;
  } else a2 = {};
  Object.defineProperty(a2, "__esModule", { value: true });
  Object.keys(n2).forEach(function(k) {
    var d = Object.getOwnPropertyDescriptor(n2, k);
    Object.defineProperty(a2, k, d.get ? d : {
      enumerable: true,
      get: function() {
        return n2[k];
      }
    });
  });
  return a2;
}
var picocolors_browser = { exports: {} };
var x$2 = String;
var create = function() {
  return { isColorSupported: false, reset: x$2, bold: x$2, dim: x$2, italic: x$2, underline: x$2, inverse: x$2, hidden: x$2, strikethrough: x$2, black: x$2, red: x$2, green: x$2, yellow: x$2, blue: x$2, magenta: x$2, cyan: x$2, white: x$2, gray: x$2, bgBlack: x$2, bgRed: x$2, bgGreen: x$2, bgYellow: x$2, bgBlue: x$2, bgMagenta: x$2, bgCyan: x$2, bgWhite: x$2 };
};
picocolors_browser.exports = create();
picocolors_browser.exports.createColors = create;
var picocolors_browserExports = picocolors_browser.exports;
const __viteBrowserExternal = {};
const __viteBrowserExternal$1 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: __viteBrowserExternal
}, Symbol.toStringTag, { value: "Module" }));
const require$$2 = /* @__PURE__ */ getAugmentedNamespace(__viteBrowserExternal$1);
let pico = picocolors_browserExports;
let terminalHighlight$1 = require$$2;
let CssSyntaxError$3 = class CssSyntaxError2 extends Error {
  constructor(message, line, column, source, file, plugin22) {
    super(message);
    this.name = "CssSyntaxError";
    this.reason = message;
    if (file) {
      this.file = file;
    }
    if (source) {
      this.source = source;
    }
    if (plugin22) {
      this.plugin = plugin22;
    }
    if (typeof line !== "undefined" && typeof column !== "undefined") {
      if (typeof line === "number") {
        this.line = line;
        this.column = column;
      } else {
        this.line = line.line;
        this.column = line.column;
        this.endLine = column.line;
        this.endColumn = column.column;
      }
    }
    this.setMessage();
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, CssSyntaxError2);
    }
  }
  setMessage() {
    this.message = this.plugin ? this.plugin + ": " : "";
    this.message += this.file ? this.file : "<css input>";
    if (typeof this.line !== "undefined") {
      this.message += ":" + this.line + ":" + this.column;
    }
    this.message += ": " + this.reason;
  }
  showSourceCode(color) {
    if (!this.source) return "";
    let css = this.source;
    if (color == null) color = pico.isColorSupported;
    if (terminalHighlight$1) {
      if (color) css = terminalHighlight$1(css);
    }
    let lines = css.split(/\r?\n/);
    let start = Math.max(this.line - 3, 0);
    let end = Math.min(this.line + 2, lines.length);
    let maxWidth = String(end).length;
    let mark, aside;
    if (color) {
      let { bold, gray, red } = pico.createColors(true);
      mark = (text2) => bold(red(text2));
      aside = (text2) => gray(text2);
    } else {
      mark = aside = (str) => str;
    }
    return lines.slice(start, end).map((line, index2) => {
      let number = start + 1 + index2;
      let gutter = " " + (" " + number).slice(-maxWidth) + " | ";
      if (number === this.line) {
        let spacing = aside(gutter.replace(/\d/g, " ")) + line.slice(0, this.column - 1).replace(/[^\t]/g, " ");
        return mark(">") + aside(gutter) + line + "\n " + spacing + mark("^");
      }
      return " " + aside(gutter) + line;
    }).join("\n");
  }
  toString() {
    let code = this.showSourceCode();
    if (code) {
      code = "\n\n" + code + "\n";
    }
    return this.name + ": " + this.message + code;
  }
};
var cssSyntaxError = CssSyntaxError$3;
CssSyntaxError$3.default = CssSyntaxError$3;
var symbols = {};
symbols.isClean = Symbol("isClean");
symbols.my = Symbol("my");
const DEFAULT_RAW = {
  after: "\n",
  beforeClose: "\n",
  beforeComment: "\n",
  beforeDecl: "\n",
  beforeOpen: " ",
  beforeRule: "\n",
  colon: ": ",
  commentLeft: " ",
  commentRight: " ",
  emptyBody: "",
  indent: "    ",
  semicolon: false
};
function capitalize(str) {
  return str[0].toUpperCase() + str.slice(1);
}
let Stringifier$2 = class Stringifier2 {
  constructor(builder) {
    this.builder = builder;
  }
  atrule(node2, semicolon) {
    let name = "@" + node2.name;
    let params = node2.params ? this.rawValue(node2, "params") : "";
    if (typeof node2.raws.afterName !== "undefined") {
      name += node2.raws.afterName;
    } else if (params) {
      name += " ";
    }
    if (node2.nodes) {
      this.block(node2, name + params);
    } else {
      let end = (node2.raws.between || "") + (semicolon ? ";" : "");
      this.builder(name + params + end, node2);
    }
  }
  beforeAfter(node2, detect) {
    let value;
    if (node2.type === "decl") {
      value = this.raw(node2, null, "beforeDecl");
    } else if (node2.type === "comment") {
      value = this.raw(node2, null, "beforeComment");
    } else if (detect === "before") {
      value = this.raw(node2, null, "beforeRule");
    } else {
      value = this.raw(node2, null, "beforeClose");
    }
    let buf = node2.parent;
    let depth = 0;
    while (buf && buf.type !== "root") {
      depth += 1;
      buf = buf.parent;
    }
    if (value.includes("\n")) {
      let indent = this.raw(node2, null, "indent");
      if (indent.length) {
        for (let step = 0; step < depth; step++) value += indent;
      }
    }
    return value;
  }
  block(node2, start) {
    let between = this.raw(node2, "between", "beforeOpen");
    this.builder(start + between + "{", node2, "start");
    let after;
    if (node2.nodes && node2.nodes.length) {
      this.body(node2);
      after = this.raw(node2, "after");
    } else {
      after = this.raw(node2, "after", "emptyBody");
    }
    if (after) this.builder(after);
    this.builder("}", node2, "end");
  }
  body(node2) {
    let last = node2.nodes.length - 1;
    while (last > 0) {
      if (node2.nodes[last].type !== "comment") break;
      last -= 1;
    }
    let semicolon = this.raw(node2, "semicolon");
    for (let i2 = 0; i2 < node2.nodes.length; i2++) {
      let child = node2.nodes[i2];
      let before = this.raw(child, "before");
      if (before) this.builder(before);
      this.stringify(child, last !== i2 || semicolon);
    }
  }
  comment(node2) {
    let left = this.raw(node2, "left", "commentLeft");
    let right = this.raw(node2, "right", "commentRight");
    this.builder("/*" + left + node2.text + right + "*/", node2);
  }
  decl(node2, semicolon) {
    let between = this.raw(node2, "between", "colon");
    let string = node2.prop + between + this.rawValue(node2, "value");
    if (node2.important) {
      string += node2.raws.important || " !important";
    }
    if (semicolon) string += ";";
    this.builder(string, node2);
  }
  document(node2) {
    this.body(node2);
  }
  raw(node2, own, detect) {
    let value;
    if (!detect) detect = own;
    if (own) {
      value = node2.raws[own];
      if (typeof value !== "undefined") return value;
    }
    let parent = node2.parent;
    if (detect === "before") {
      if (!parent || parent.type === "root" && parent.first === node2) {
        return "";
      }
      if (parent && parent.type === "document") {
        return "";
      }
    }
    if (!parent) return DEFAULT_RAW[detect];
    let root2 = node2.root();
    if (!root2.rawCache) root2.rawCache = {};
    if (typeof root2.rawCache[detect] !== "undefined") {
      return root2.rawCache[detect];
    }
    if (detect === "before" || detect === "after") {
      return this.beforeAfter(node2, detect);
    } else {
      let method = "raw" + capitalize(detect);
      if (this[method]) {
        value = this[method](root2, node2);
      } else {
        root2.walk((i2) => {
          value = i2.raws[own];
          if (typeof value !== "undefined") return false;
        });
      }
    }
    if (typeof value === "undefined") value = DEFAULT_RAW[detect];
    root2.rawCache[detect] = value;
    return value;
  }
  rawBeforeClose(root2) {
    let value;
    root2.walk((i2) => {
      if (i2.nodes && i2.nodes.length > 0) {
        if (typeof i2.raws.after !== "undefined") {
          value = i2.raws.after;
          if (value.includes("\n")) {
            value = value.replace(/[^\n]+$/, "");
          }
          return false;
        }
      }
    });
    if (value) value = value.replace(/\S/g, "");
    return value;
  }
  rawBeforeComment(root2, node2) {
    let value;
    root2.walkComments((i2) => {
      if (typeof i2.raws.before !== "undefined") {
        value = i2.raws.before;
        if (value.includes("\n")) {
          value = value.replace(/[^\n]+$/, "");
        }
        return false;
      }
    });
    if (typeof value === "undefined") {
      value = this.raw(node2, null, "beforeDecl");
    } else if (value) {
      value = value.replace(/\S/g, "");
    }
    return value;
  }
  rawBeforeDecl(root2, node2) {
    let value;
    root2.walkDecls((i2) => {
      if (typeof i2.raws.before !== "undefined") {
        value = i2.raws.before;
        if (value.includes("\n")) {
          value = value.replace(/[^\n]+$/, "");
        }
        return false;
      }
    });
    if (typeof value === "undefined") {
      value = this.raw(node2, null, "beforeRule");
    } else if (value) {
      value = value.replace(/\S/g, "");
    }
    return value;
  }
  rawBeforeOpen(root2) {
    let value;
    root2.walk((i2) => {
      if (i2.type !== "decl") {
        value = i2.raws.between;
        if (typeof value !== "undefined") return false;
      }
    });
    return value;
  }
  rawBeforeRule(root2) {
    let value;
    root2.walk((i2) => {
      if (i2.nodes && (i2.parent !== root2 || root2.first !== i2)) {
        if (typeof i2.raws.before !== "undefined") {
          value = i2.raws.before;
          if (value.includes("\n")) {
            value = value.replace(/[^\n]+$/, "");
          }
          return false;
        }
      }
    });
    if (value) value = value.replace(/\S/g, "");
    return value;
  }
  rawColon(root2) {
    let value;
    root2.walkDecls((i2) => {
      if (typeof i2.raws.between !== "undefined") {
        value = i2.raws.between.replace(/[^\s:]/g, "");
        return false;
      }
    });
    return value;
  }
  rawEmptyBody(root2) {
    let value;
    root2.walk((i2) => {
      if (i2.nodes && i2.nodes.length === 0) {
        value = i2.raws.after;
        if (typeof value !== "undefined") return false;
      }
    });
    return value;
  }
  rawIndent(root2) {
    if (root2.raws.indent) return root2.raws.indent;
    let value;
    root2.walk((i2) => {
      let p = i2.parent;
      if (p && p !== root2 && p.parent && p.parent === root2) {
        if (typeof i2.raws.before !== "undefined") {
          let parts = i2.raws.before.split("\n");
          value = parts[parts.length - 1];
          value = value.replace(/\S/g, "");
          return false;
        }
      }
    });
    return value;
  }
  rawSemicolon(root2) {
    let value;
    root2.walk((i2) => {
      if (i2.nodes && i2.nodes.length && i2.last.type === "decl") {
        value = i2.raws.semicolon;
        if (typeof value !== "undefined") return false;
      }
    });
    return value;
  }
  rawValue(node2, prop) {
    let value = node2[prop];
    let raw = node2.raws[prop];
    if (raw && raw.value === value) {
      return raw.raw;
    }
    return value;
  }
  root(node2) {
    this.body(node2);
    if (node2.raws.after) this.builder(node2.raws.after);
  }
  rule(node2) {
    this.block(node2, this.rawValue(node2, "selector"));
    if (node2.raws.ownSemicolon) {
      this.builder(node2.raws.ownSemicolon, node2, "end");
    }
  }
  stringify(node2, semicolon) {
    if (!this[node2.type]) {
      throw new Error(
        "Unknown AST node type " + node2.type + ". Maybe you need to change PostCSS stringifier."
      );
    }
    this[node2.type](node2, semicolon);
  }
};
var stringifier = Stringifier$2;
Stringifier$2.default = Stringifier$2;
let Stringifier$1 = stringifier;
function stringify$4(node2, builder) {
  let str = new Stringifier$1(builder);
  str.stringify(node2);
}
var stringify_1 = stringify$4;
stringify$4.default = stringify$4;
let { isClean: isClean$2, my: my$2 } = symbols;
let CssSyntaxError$2 = cssSyntaxError;
let Stringifier22 = stringifier;
let stringify$3 = stringify_1;
function cloneNode(obj, parent) {
  let cloned = new obj.constructor();
  for (let i2 in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, i2)) {
      continue;
    }
    if (i2 === "proxyCache") continue;
    let value = obj[i2];
    let type = typeof value;
    if (i2 === "parent" && type === "object") {
      if (parent) cloned[i2] = parent;
    } else if (i2 === "source") {
      cloned[i2] = value;
    } else if (Array.isArray(value)) {
      cloned[i2] = value.map((j) => cloneNode(j, cloned));
    } else {
      if (type === "object" && value !== null) value = cloneNode(value);
      cloned[i2] = value;
    }
  }
  return cloned;
}
let Node$4 = class Node3 {
  constructor(defaults = {}) {
    this.raws = {};
    this[isClean$2] = false;
    this[my$2] = true;
    for (let name in defaults) {
      if (name === "nodes") {
        this.nodes = [];
        for (let node2 of defaults[name]) {
          if (typeof node2.clone === "function") {
            this.append(node2.clone());
          } else {
            this.append(node2);
          }
        }
      } else {
        this[name] = defaults[name];
      }
    }
  }
  addToError(error) {
    error.postcssNode = this;
    if (error.stack && this.source && /\n\s{4}at /.test(error.stack)) {
      let s2 = this.source;
      error.stack = error.stack.replace(
        /\n\s{4}at /,
        `$&${s2.input.from}:${s2.start.line}:${s2.start.column}$&`
      );
    }
    return error;
  }
  after(add) {
    this.parent.insertAfter(this, add);
    return this;
  }
  assign(overrides = {}) {
    for (let name in overrides) {
      this[name] = overrides[name];
    }
    return this;
  }
  before(add) {
    this.parent.insertBefore(this, add);
    return this;
  }
  cleanRaws(keepBetween) {
    delete this.raws.before;
    delete this.raws.after;
    if (!keepBetween) delete this.raws.between;
  }
  clone(overrides = {}) {
    let cloned = cloneNode(this);
    for (let name in overrides) {
      cloned[name] = overrides[name];
    }
    return cloned;
  }
  cloneAfter(overrides = {}) {
    let cloned = this.clone(overrides);
    this.parent.insertAfter(this, cloned);
    return cloned;
  }
  cloneBefore(overrides = {}) {
    let cloned = this.clone(overrides);
    this.parent.insertBefore(this, cloned);
    return cloned;
  }
  error(message, opts = {}) {
    if (this.source) {
      let { end, start } = this.rangeBy(opts);
      return this.source.input.error(
        message,
        { column: start.column, line: start.line },
        { column: end.column, line: end.line },
        opts
      );
    }
    return new CssSyntaxError$2(message);
  }
  getProxyProcessor() {
    return {
      get(node2, prop) {
        if (prop === "proxyOf") {
          return node2;
        } else if (prop === "root") {
          return () => node2.root().toProxy();
        } else {
          return node2[prop];
        }
      },
      set(node2, prop, value) {
        if (node2[prop] === value) return true;
        node2[prop] = value;
        if (prop === "prop" || prop === "value" || prop === "name" || prop === "params" || prop === "important" || /* c8 ignore next */
        prop === "text") {
          node2.markDirty();
        }
        return true;
      }
    };
  }
  markDirty() {
    if (this[isClean$2]) {
      this[isClean$2] = false;
      let next = this;
      while (next = next.parent) {
        next[isClean$2] = false;
      }
    }
  }
  next() {
    if (!this.parent) return void 0;
    let index2 = this.parent.index(this);
    return this.parent.nodes[index2 + 1];
  }
  positionBy(opts, stringRepresentation) {
    let pos = this.source.start;
    if (opts.index) {
      pos = this.positionInside(opts.index, stringRepresentation);
    } else if (opts.word) {
      stringRepresentation = this.toString();
      let index2 = stringRepresentation.indexOf(opts.word);
      if (index2 !== -1) pos = this.positionInside(index2, stringRepresentation);
    }
    return pos;
  }
  positionInside(index2, stringRepresentation) {
    let string = stringRepresentation || this.toString();
    let column = this.source.start.column;
    let line = this.source.start.line;
    for (let i2 = 0; i2 < index2; i2++) {
      if (string[i2] === "\n") {
        column = 1;
        line += 1;
      } else {
        column += 1;
      }
    }
    return { column, line };
  }
  prev() {
    if (!this.parent) return void 0;
    let index2 = this.parent.index(this);
    return this.parent.nodes[index2 - 1];
  }
  rangeBy(opts) {
    let start = {
      column: this.source.start.column,
      line: this.source.start.line
    };
    let end = this.source.end ? {
      column: this.source.end.column + 1,
      line: this.source.end.line
    } : {
      column: start.column + 1,
      line: start.line
    };
    if (opts.word) {
      let stringRepresentation = this.toString();
      let index2 = stringRepresentation.indexOf(opts.word);
      if (index2 !== -1) {
        start = this.positionInside(index2, stringRepresentation);
        end = this.positionInside(index2 + opts.word.length, stringRepresentation);
      }
    } else {
      if (opts.start) {
        start = {
          column: opts.start.column,
          line: opts.start.line
        };
      } else if (opts.index) {
        start = this.positionInside(opts.index);
      }
      if (opts.end) {
        end = {
          column: opts.end.column,
          line: opts.end.line
        };
      } else if (typeof opts.endIndex === "number") {
        end = this.positionInside(opts.endIndex);
      } else if (opts.index) {
        end = this.positionInside(opts.index + 1);
      }
    }
    if (end.line < start.line || end.line === start.line && end.column <= start.column) {
      end = { column: start.column + 1, line: start.line };
    }
    return { end, start };
  }
  raw(prop, defaultType) {
    let str = new Stringifier22();
    return str.raw(this, prop, defaultType);
  }
  remove() {
    if (this.parent) {
      this.parent.removeChild(this);
    }
    this.parent = void 0;
    return this;
  }
  replaceWith(...nodes) {
    if (this.parent) {
      let bookmark = this;
      let foundSelf = false;
      for (let node2 of nodes) {
        if (node2 === this) {
          foundSelf = true;
        } else if (foundSelf) {
          this.parent.insertAfter(bookmark, node2);
          bookmark = node2;
        } else {
          this.parent.insertBefore(bookmark, node2);
        }
      }
      if (!foundSelf) {
        this.remove();
      }
    }
    return this;
  }
  root() {
    let result2 = this;
    while (result2.parent && result2.parent.type !== "document") {
      result2 = result2.parent;
    }
    return result2;
  }
  toJSON(_, inputs) {
    let fixed = {};
    let emitInputs = inputs == null;
    inputs = inputs || /* @__PURE__ */ new Map();
    let inputsNextIndex = 0;
    for (let name in this) {
      if (!Object.prototype.hasOwnProperty.call(this, name)) {
        continue;
      }
      if (name === "parent" || name === "proxyCache") continue;
      let value = this[name];
      if (Array.isArray(value)) {
        fixed[name] = value.map((i2) => {
          if (typeof i2 === "object" && i2.toJSON) {
            return i2.toJSON(null, inputs);
          } else {
            return i2;
          }
        });
      } else if (typeof value === "object" && value.toJSON) {
        fixed[name] = value.toJSON(null, inputs);
      } else if (name === "source") {
        let inputId = inputs.get(value.input);
        if (inputId == null) {
          inputId = inputsNextIndex;
          inputs.set(value.input, inputsNextIndex);
          inputsNextIndex++;
        }
        fixed[name] = {
          end: value.end,
          inputId,
          start: value.start
        };
      } else {
        fixed[name] = value;
      }
    }
    if (emitInputs) {
      fixed.inputs = [...inputs.keys()].map((input2) => input2.toJSON());
    }
    return fixed;
  }
  toProxy() {
    if (!this.proxyCache) {
      this.proxyCache = new Proxy(this, this.getProxyProcessor());
    }
    return this.proxyCache;
  }
  toString(stringifier2 = stringify$3) {
    if (stringifier2.stringify) stringifier2 = stringifier2.stringify;
    let result2 = "";
    stringifier2(this, (i2) => {
      result2 += i2;
    });
    return result2;
  }
  warn(result2, text2, opts) {
    let data = { node: this };
    for (let i2 in opts) data[i2] = opts[i2];
    return result2.warn(text2, data);
  }
  get proxyOf() {
    return this;
  }
};
var node = Node$4;
Node$4.default = Node$4;
let Node$3 = node;
let Declaration$4 = class Declaration2 extends Node$3 {
  constructor(defaults) {
    if (defaults && typeof defaults.value !== "undefined" && typeof defaults.value !== "string") {
      defaults = __spreadProps(__spreadValues({}, defaults), { value: String(defaults.value) });
    }
    super(defaults);
    this.type = "decl";
  }
  get variable() {
    return this.prop.startsWith("--") || this.prop[0] === "$";
  }
};
var declaration = Declaration$4;
Declaration$4.default = Declaration$4;
let urlAlphabet = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";
let customAlphabet = (alphabet, defaultSize = 21) => {
  return (size = defaultSize) => {
    let id = "";
    let i2 = size;
    while (i2--) {
      id += alphabet[Math.random() * alphabet.length | 0];
    }
    return id;
  };
};
let nanoid$1 = (size = 21) => {
  let id = "";
  let i2 = size;
  while (i2--) {
    id += urlAlphabet[Math.random() * 64 | 0];
  }
  return id;
};
var nonSecure = { nanoid: nanoid$1, customAlphabet };
let { SourceMapConsumer: SourceMapConsumer$2, SourceMapGenerator: SourceMapGenerator$2 } = require$$2;
let { existsSync, readFileSync } = require$$2;
let { dirname: dirname$1, join } = require$$2;
function fromBase64(str) {
  if (Buffer) {
    return Buffer.from(str, "base64").toString();
  } else {
    return window.atob(str);
  }
}
let PreviousMap$2 = class PreviousMap2 {
  constructor(css, opts) {
    if (opts.map === false) return;
    this.loadAnnotation(css);
    this.inline = this.startWith(this.annotation, "data:");
    let prev = opts.map ? opts.map.prev : void 0;
    let text2 = this.loadMap(opts.from, prev);
    if (!this.mapFile && opts.from) {
      this.mapFile = opts.from;
    }
    if (this.mapFile) this.root = dirname$1(this.mapFile);
    if (text2) this.text = text2;
  }
  consumer() {
    if (!this.consumerCache) {
      this.consumerCache = new SourceMapConsumer$2(this.text);
    }
    return this.consumerCache;
  }
  decodeInline(text2) {
    let baseCharsetUri = /^data:application\/json;charset=utf-?8;base64,/;
    let baseUri = /^data:application\/json;base64,/;
    let charsetUri = /^data:application\/json;charset=utf-?8,/;
    let uri = /^data:application\/json,/;
    if (charsetUri.test(text2) || uri.test(text2)) {
      return decodeURIComponent(text2.substr(RegExp.lastMatch.length));
    }
    if (baseCharsetUri.test(text2) || baseUri.test(text2)) {
      return fromBase64(text2.substr(RegExp.lastMatch.length));
    }
    let encoding = text2.match(/data:application\/json;([^,]+),/)[1];
    throw new Error("Unsupported source map encoding " + encoding);
  }
  getAnnotationURL(sourceMapString) {
    return sourceMapString.replace(/^\/\*\s*# sourceMappingURL=/, "").trim();
  }
  isMap(map) {
    if (typeof map !== "object") return false;
    return typeof map.mappings === "string" || typeof map._mappings === "string" || Array.isArray(map.sections);
  }
  loadAnnotation(css) {
    let comments = css.match(/\/\*\s*# sourceMappingURL=/gm);
    if (!comments) return;
    let start = css.lastIndexOf(comments.pop());
    let end = css.indexOf("*/", start);
    if (start > -1 && end > -1) {
      this.annotation = this.getAnnotationURL(css.substring(start, end));
    }
  }
  loadFile(path) {
    this.root = dirname$1(path);
    if (existsSync(path)) {
      this.mapFile = path;
      return readFileSync(path, "utf-8").toString().trim();
    }
  }
  loadMap(file, prev) {
    if (prev === false) return false;
    if (prev) {
      if (typeof prev === "string") {
        return prev;
      } else if (typeof prev === "function") {
        let prevPath = prev(file);
        if (prevPath) {
          let map = this.loadFile(prevPath);
          if (!map) {
            throw new Error(
              "Unable to load previous source map: " + prevPath.toString()
            );
          }
          return map;
        }
      } else if (prev instanceof SourceMapConsumer$2) {
        return SourceMapGenerator$2.fromSourceMap(prev).toString();
      } else if (prev instanceof SourceMapGenerator$2) {
        return prev.toString();
      } else if (this.isMap(prev)) {
        return JSON.stringify(prev);
      } else {
        throw new Error(
          "Unsupported previous source map format: " + prev.toString()
        );
      }
    } else if (this.inline) {
      return this.decodeInline(this.annotation);
    } else if (this.annotation) {
      let map = this.annotation;
      if (file) map = join(dirname$1(file), map);
      return this.loadFile(map);
    }
  }
  startWith(string, start) {
    if (!string) return false;
    return string.substr(0, start.length) === start;
  }
  withContent() {
    return !!(this.consumer().sourcesContent && this.consumer().sourcesContent.length > 0);
  }
};
var previousMap = PreviousMap$2;
PreviousMap$2.default = PreviousMap$2;
let { SourceMapConsumer: SourceMapConsumer$1, SourceMapGenerator: SourceMapGenerator$1 } = require$$2;
let { fileURLToPath, pathToFileURL: pathToFileURL$1 } = require$$2;
let { isAbsolute, resolve: resolve$1 } = require$$2;
let { nanoid } = nonSecure;
let terminalHighlight = require$$2;
let CssSyntaxError$1 = cssSyntaxError;
let PreviousMap$1 = previousMap;
let fromOffsetCache = Symbol("fromOffsetCache");
let sourceMapAvailable$1 = Boolean(SourceMapConsumer$1 && SourceMapGenerator$1);
let pathAvailable$1 = Boolean(resolve$1 && isAbsolute);
let Input$4 = class Input2 {
  constructor(css, opts = {}) {
    if (css === null || typeof css === "undefined" || typeof css === "object" && !css.toString) {
      throw new Error(`PostCSS received ${css} instead of CSS string`);
    }
    this.css = css.toString();
    if (this.css[0] === "\uFEFF" || this.css[0] === "\uFFFE") {
      this.hasBOM = true;
      this.css = this.css.slice(1);
    } else {
      this.hasBOM = false;
    }
    if (opts.from) {
      if (!pathAvailable$1 || /^\w+:\/\//.test(opts.from) || isAbsolute(opts.from)) {
        this.file = opts.from;
      } else {
        this.file = resolve$1(opts.from);
      }
    }
    if (pathAvailable$1 && sourceMapAvailable$1) {
      let map = new PreviousMap$1(this.css, opts);
      if (map.text) {
        this.map = map;
        let file = map.consumer().file;
        if (!this.file && file) this.file = this.mapResolve(file);
      }
    }
    if (!this.file) {
      this.id = "<input css " + nanoid(6) + ">";
    }
    if (this.map) this.map.file = this.from;
  }
  error(message, line, column, opts = {}) {
    let result2, endLine, endColumn;
    if (line && typeof line === "object") {
      let start = line;
      let end = column;
      if (typeof start.offset === "number") {
        let pos = this.fromOffset(start.offset);
        line = pos.line;
        column = pos.col;
      } else {
        line = start.line;
        column = start.column;
      }
      if (typeof end.offset === "number") {
        let pos = this.fromOffset(end.offset);
        endLine = pos.line;
        endColumn = pos.col;
      } else {
        endLine = end.line;
        endColumn = end.column;
      }
    } else if (!column) {
      let pos = this.fromOffset(line);
      line = pos.line;
      column = pos.col;
    }
    let origin = this.origin(line, column, endLine, endColumn);
    if (origin) {
      result2 = new CssSyntaxError$1(
        message,
        origin.endLine === void 0 ? origin.line : { column: origin.column, line: origin.line },
        origin.endLine === void 0 ? origin.column : { column: origin.endColumn, line: origin.endLine },
        origin.source,
        origin.file,
        opts.plugin
      );
    } else {
      result2 = new CssSyntaxError$1(
        message,
        endLine === void 0 ? line : { column, line },
        endLine === void 0 ? column : { column: endColumn, line: endLine },
        this.css,
        this.file,
        opts.plugin
      );
    }
    result2.input = { column, endColumn, endLine, line, source: this.css };
    if (this.file) {
      if (pathToFileURL$1) {
        result2.input.url = pathToFileURL$1(this.file).toString();
      }
      result2.input.file = this.file;
    }
    return result2;
  }
  fromOffset(offset) {
    let lastLine, lineToIndex;
    if (!this[fromOffsetCache]) {
      let lines = this.css.split("\n");
      lineToIndex = new Array(lines.length);
      let prevIndex = 0;
      for (let i2 = 0, l2 = lines.length; i2 < l2; i2++) {
        lineToIndex[i2] = prevIndex;
        prevIndex += lines[i2].length + 1;
      }
      this[fromOffsetCache] = lineToIndex;
    } else {
      lineToIndex = this[fromOffsetCache];
    }
    lastLine = lineToIndex[lineToIndex.length - 1];
    let min = 0;
    if (offset >= lastLine) {
      min = lineToIndex.length - 1;
    } else {
      let max2 = lineToIndex.length - 2;
      let mid;
      while (min < max2) {
        mid = min + (max2 - min >> 1);
        if (offset < lineToIndex[mid]) {
          max2 = mid - 1;
        } else if (offset >= lineToIndex[mid + 1]) {
          min = mid + 1;
        } else {
          min = mid;
          break;
        }
      }
    }
    return {
      col: offset - lineToIndex[min] + 1,
      line: min + 1
    };
  }
  mapResolve(file) {
    if (/^\w+:\/\//.test(file)) {
      return file;
    }
    return resolve$1(this.map.consumer().sourceRoot || this.map.root || ".", file);
  }
  origin(line, column, endLine, endColumn) {
    if (!this.map) return false;
    let consumer = this.map.consumer();
    let from = consumer.originalPositionFor({ column, line });
    if (!from.source) return false;
    let to;
    if (typeof endLine === "number") {
      to = consumer.originalPositionFor({ column: endColumn, line: endLine });
    }
    let fromUrl;
    if (isAbsolute(from.source)) {
      fromUrl = pathToFileURL$1(from.source);
    } else {
      fromUrl = new URL(
        from.source,
        this.map.consumer().sourceRoot || pathToFileURL$1(this.map.mapFile)
      );
    }
    let result2 = {
      column: from.column,
      endColumn: to && to.column,
      endLine: to && to.line,
      line: from.line,
      url: fromUrl.toString()
    };
    if (fromUrl.protocol === "file:") {
      if (fileURLToPath) {
        result2.file = fileURLToPath(fromUrl);
      } else {
        throw new Error(`file: protocol is not available in this PostCSS build`);
      }
    }
    let source = consumer.sourceContentFor(from.source);
    if (source) result2.source = source;
    return result2;
  }
  toJSON() {
    let json = {};
    for (let name of ["hasBOM", "css", "file", "id"]) {
      if (this[name] != null) {
        json[name] = this[name];
      }
    }
    if (this.map) {
      json.map = __spreadValues({}, this.map);
      if (json.map.consumerCache) {
        json.map.consumerCache = void 0;
      }
    }
    return json;
  }
  get from() {
    return this.file || this.id;
  }
};
var input = Input$4;
Input$4.default = Input$4;
if (terminalHighlight && terminalHighlight.registerInput) {
  terminalHighlight.registerInput(Input$4);
}
let { SourceMapConsumer, SourceMapGenerator } = require$$2;
let { dirname, relative, resolve, sep } = require$$2;
let { pathToFileURL } = require$$2;
let Input$3 = input;
let sourceMapAvailable = Boolean(SourceMapConsumer && SourceMapGenerator);
let pathAvailable = Boolean(dirname && resolve && relative && sep);
let MapGenerator$2 = class MapGenerator2 {
  constructor(stringify2, root2, opts, cssString) {
    this.stringify = stringify2;
    this.mapOpts = opts.map || {};
    this.root = root2;
    this.opts = opts;
    this.css = cssString;
    this.originalCSS = cssString;
    this.usesFileUrls = !this.mapOpts.from && this.mapOpts.absolute;
    this.memoizedFileURLs = /* @__PURE__ */ new Map();
    this.memoizedPaths = /* @__PURE__ */ new Map();
    this.memoizedURLs = /* @__PURE__ */ new Map();
  }
  addAnnotation() {
    let content;
    if (this.isInline()) {
      content = "data:application/json;base64," + this.toBase64(this.map.toString());
    } else if (typeof this.mapOpts.annotation === "string") {
      content = this.mapOpts.annotation;
    } else if (typeof this.mapOpts.annotation === "function") {
      content = this.mapOpts.annotation(this.opts.to, this.root);
    } else {
      content = this.outputFile() + ".map";
    }
    let eol = "\n";
    if (this.css.includes("\r\n")) eol = "\r\n";
    this.css += eol + "/*# sourceMappingURL=" + content + " */";
  }
  applyPrevMaps() {
    for (let prev of this.previous()) {
      let from = this.toUrl(this.path(prev.file));
      let root2 = prev.root || dirname(prev.file);
      let map;
      if (this.mapOpts.sourcesContent === false) {
        map = new SourceMapConsumer(prev.text);
        if (map.sourcesContent) {
          map.sourcesContent = null;
        }
      } else {
        map = prev.consumer();
      }
      this.map.applySourceMap(map, from, this.toUrl(this.path(root2)));
    }
  }
  clearAnnotation() {
    if (this.mapOpts.annotation === false) return;
    if (this.root) {
      let node2;
      for (let i2 = this.root.nodes.length - 1; i2 >= 0; i2--) {
        node2 = this.root.nodes[i2];
        if (node2.type !== "comment") continue;
        if (node2.text.indexOf("# sourceMappingURL=") === 0) {
          this.root.removeChild(i2);
        }
      }
    } else if (this.css) {
      this.css = this.css.replace(/\n*?\/\*#[\S\s]*?\*\/$/gm, "");
    }
  }
  generate() {
    this.clearAnnotation();
    if (pathAvailable && sourceMapAvailable && this.isMap()) {
      return this.generateMap();
    } else {
      let result2 = "";
      this.stringify(this.root, (i2) => {
        result2 += i2;
      });
      return [result2];
    }
  }
  generateMap() {
    if (this.root) {
      this.generateString();
    } else if (this.previous().length === 1) {
      let prev = this.previous()[0].consumer();
      prev.file = this.outputFile();
      this.map = SourceMapGenerator.fromSourceMap(prev, {
        ignoreInvalidMapping: true
      });
    } else {
      this.map = new SourceMapGenerator({
        file: this.outputFile(),
        ignoreInvalidMapping: true
      });
      this.map.addMapping({
        generated: { column: 0, line: 1 },
        original: { column: 0, line: 1 },
        source: this.opts.from ? this.toUrl(this.path(this.opts.from)) : "<no source>"
      });
    }
    if (this.isSourcesContent()) this.setSourcesContent();
    if (this.root && this.previous().length > 0) this.applyPrevMaps();
    if (this.isAnnotation()) this.addAnnotation();
    if (this.isInline()) {
      return [this.css];
    } else {
      return [this.css, this.map];
    }
  }
  generateString() {
    this.css = "";
    this.map = new SourceMapGenerator({
      file: this.outputFile(),
      ignoreInvalidMapping: true
    });
    let line = 1;
    let column = 1;
    let noSource = "<no source>";
    let mapping = {
      generated: { column: 0, line: 0 },
      original: { column: 0, line: 0 },
      source: ""
    };
    let lines, last;
    this.stringify(this.root, (str, node2, type) => {
      this.css += str;
      if (node2 && type !== "end") {
        mapping.generated.line = line;
        mapping.generated.column = column - 1;
        if (node2.source && node2.source.start) {
          mapping.source = this.sourcePath(node2);
          mapping.original.line = node2.source.start.line;
          mapping.original.column = node2.source.start.column - 1;
          this.map.addMapping(mapping);
        } else {
          mapping.source = noSource;
          mapping.original.line = 1;
          mapping.original.column = 0;
          this.map.addMapping(mapping);
        }
      }
      lines = str.match(/\n/g);
      if (lines) {
        line += lines.length;
        last = str.lastIndexOf("\n");
        column = str.length - last;
      } else {
        column += str.length;
      }
      if (node2 && type !== "start") {
        let p = node2.parent || { raws: {} };
        let childless = node2.type === "decl" || node2.type === "atrule" && !node2.nodes;
        if (!childless || node2 !== p.last || p.raws.semicolon) {
          if (node2.source && node2.source.end) {
            mapping.source = this.sourcePath(node2);
            mapping.original.line = node2.source.end.line;
            mapping.original.column = node2.source.end.column - 1;
            mapping.generated.line = line;
            mapping.generated.column = column - 2;
            this.map.addMapping(mapping);
          } else {
            mapping.source = noSource;
            mapping.original.line = 1;
            mapping.original.column = 0;
            mapping.generated.line = line;
            mapping.generated.column = column - 1;
            this.map.addMapping(mapping);
          }
        }
      }
    });
  }
  isAnnotation() {
    if (this.isInline()) {
      return true;
    }
    if (typeof this.mapOpts.annotation !== "undefined") {
      return this.mapOpts.annotation;
    }
    if (this.previous().length) {
      return this.previous().some((i2) => i2.annotation);
    }
    return true;
  }
  isInline() {
    if (typeof this.mapOpts.inline !== "undefined") {
      return this.mapOpts.inline;
    }
    let annotation = this.mapOpts.annotation;
    if (typeof annotation !== "undefined" && annotation !== true) {
      return false;
    }
    if (this.previous().length) {
      return this.previous().some((i2) => i2.inline);
    }
    return true;
  }
  isMap() {
    if (typeof this.opts.map !== "undefined") {
      return !!this.opts.map;
    }
    return this.previous().length > 0;
  }
  isSourcesContent() {
    if (typeof this.mapOpts.sourcesContent !== "undefined") {
      return this.mapOpts.sourcesContent;
    }
    if (this.previous().length) {
      return this.previous().some((i2) => i2.withContent());
    }
    return true;
  }
  outputFile() {
    if (this.opts.to) {
      return this.path(this.opts.to);
    } else if (this.opts.from) {
      return this.path(this.opts.from);
    } else {
      return "to.css";
    }
  }
  path(file) {
    if (this.mapOpts.absolute) return file;
    if (file.charCodeAt(0) === 60) return file;
    if (/^\w+:\/\//.test(file)) return file;
    let cached = this.memoizedPaths.get(file);
    if (cached) return cached;
    let from = this.opts.to ? dirname(this.opts.to) : ".";
    if (typeof this.mapOpts.annotation === "string") {
      from = dirname(resolve(from, this.mapOpts.annotation));
    }
    let path = relative(from, file);
    this.memoizedPaths.set(file, path);
    return path;
  }
  previous() {
    if (!this.previousMaps) {
      this.previousMaps = [];
      if (this.root) {
        this.root.walk((node2) => {
          if (node2.source && node2.source.input.map) {
            let map = node2.source.input.map;
            if (!this.previousMaps.includes(map)) {
              this.previousMaps.push(map);
            }
          }
        });
      } else {
        let input2 = new Input$3(this.originalCSS, this.opts);
        if (input2.map) this.previousMaps.push(input2.map);
      }
    }
    return this.previousMaps;
  }
  setSourcesContent() {
    let already = {};
    if (this.root) {
      this.root.walk((node2) => {
        if (node2.source) {
          let from = node2.source.input.from;
          if (from && !already[from]) {
            already[from] = true;
            let fromUrl = this.usesFileUrls ? this.toFileUrl(from) : this.toUrl(this.path(from));
            this.map.setSourceContent(fromUrl, node2.source.input.css);
          }
        }
      });
    } else if (this.css) {
      let from = this.opts.from ? this.toUrl(this.path(this.opts.from)) : "<no source>";
      this.map.setSourceContent(from, this.css);
    }
  }
  sourcePath(node2) {
    if (this.mapOpts.from) {
      return this.toUrl(this.mapOpts.from);
    } else if (this.usesFileUrls) {
      return this.toFileUrl(node2.source.input.from);
    } else {
      return this.toUrl(this.path(node2.source.input.from));
    }
  }
  toBase64(str) {
    if (Buffer) {
      return Buffer.from(str).toString("base64");
    } else {
      return window.btoa(unescape(encodeURIComponent(str)));
    }
  }
  toFileUrl(path) {
    let cached = this.memoizedFileURLs.get(path);
    if (cached) return cached;
    if (pathToFileURL) {
      let fileURL = pathToFileURL(path).toString();
      this.memoizedFileURLs.set(path, fileURL);
      return fileURL;
    } else {
      throw new Error(
        "`map.absolute` option is not available in this PostCSS build"
      );
    }
  }
  toUrl(path) {
    let cached = this.memoizedURLs.get(path);
    if (cached) return cached;
    if (sep === "\\") {
      path = path.replace(/\\/g, "/");
    }
    let url = encodeURI(path).replace(/[#?]/g, encodeURIComponent);
    this.memoizedURLs.set(path, url);
    return url;
  }
};
var mapGenerator = MapGenerator$2;
let Node$2 = node;
let Comment$4 = class Comment2 extends Node$2 {
  constructor(defaults) {
    super(defaults);
    this.type = "comment";
  }
};
var comment = Comment$4;
Comment$4.default = Comment$4;
let { isClean: isClean$1, my: my$1 } = symbols;
let Declaration$3 = declaration;
let Comment$3 = comment;
let Node$1 = node;
let parse$4;
let Rule$4;
let AtRule$4;
let Root$6;
function cleanSource(nodes) {
  return nodes.map((i2) => {
    if (i2.nodes) i2.nodes = cleanSource(i2.nodes);
    delete i2.source;
    return i2;
  });
}
function markDirtyUp(node2) {
  node2[isClean$1] = false;
  if (node2.proxyOf.nodes) {
    for (let i2 of node2.proxyOf.nodes) {
      markDirtyUp(i2);
    }
  }
}
let Container$7 = class Container2 extends Node$1 {
  append(...children2) {
    for (let child of children2) {
      let nodes = this.normalize(child, this.last);
      for (let node2 of nodes) this.proxyOf.nodes.push(node2);
    }
    this.markDirty();
    return this;
  }
  cleanRaws(keepBetween) {
    super.cleanRaws(keepBetween);
    if (this.nodes) {
      for (let node2 of this.nodes) node2.cleanRaws(keepBetween);
    }
  }
  each(callback) {
    if (!this.proxyOf.nodes) return void 0;
    let iterator = this.getIterator();
    let index2, result2;
    while (this.indexes[iterator] < this.proxyOf.nodes.length) {
      index2 = this.indexes[iterator];
      result2 = callback(this.proxyOf.nodes[index2], index2);
      if (result2 === false) break;
      this.indexes[iterator] += 1;
    }
    delete this.indexes[iterator];
    return result2;
  }
  every(condition) {
    return this.nodes.every(condition);
  }
  getIterator() {
    if (!this.lastEach) this.lastEach = 0;
    if (!this.indexes) this.indexes = {};
    this.lastEach += 1;
    let iterator = this.lastEach;
    this.indexes[iterator] = 0;
    return iterator;
  }
  getProxyProcessor() {
    return {
      get(node2, prop) {
        if (prop === "proxyOf") {
          return node2;
        } else if (!node2[prop]) {
          return node2[prop];
        } else if (prop === "each" || typeof prop === "string" && prop.startsWith("walk")) {
          return (...args) => {
            return node2[prop](
              ...args.map((i2) => {
                if (typeof i2 === "function") {
                  return (child, index2) => i2(child.toProxy(), index2);
                } else {
                  return i2;
                }
              })
            );
          };
        } else if (prop === "every" || prop === "some") {
          return (cb) => {
            return node2[prop](
              (child, ...other) => cb(child.toProxy(), ...other)
            );
          };
        } else if (prop === "root") {
          return () => node2.root().toProxy();
        } else if (prop === "nodes") {
          return node2.nodes.map((i2) => i2.toProxy());
        } else if (prop === "first" || prop === "last") {
          return node2[prop].toProxy();
        } else {
          return node2[prop];
        }
      },
      set(node2, prop, value) {
        if (node2[prop] === value) return true;
        node2[prop] = value;
        if (prop === "name" || prop === "params" || prop === "selector") {
          node2.markDirty();
        }
        return true;
      }
    };
  }
  index(child) {
    if (typeof child === "number") return child;
    if (child.proxyOf) child = child.proxyOf;
    return this.proxyOf.nodes.indexOf(child);
  }
  insertAfter(exist, add) {
    let existIndex = this.index(exist);
    let nodes = this.normalize(add, this.proxyOf.nodes[existIndex]).reverse();
    existIndex = this.index(exist);
    for (let node2 of nodes) this.proxyOf.nodes.splice(existIndex + 1, 0, node2);
    let index2;
    for (let id in this.indexes) {
      index2 = this.indexes[id];
      if (existIndex < index2) {
        this.indexes[id] = index2 + nodes.length;
      }
    }
    this.markDirty();
    return this;
  }
  insertBefore(exist, add) {
    let existIndex = this.index(exist);
    let type = existIndex === 0 ? "prepend" : false;
    let nodes = this.normalize(add, this.proxyOf.nodes[existIndex], type).reverse();
    existIndex = this.index(exist);
    for (let node2 of nodes) this.proxyOf.nodes.splice(existIndex, 0, node2);
    let index2;
    for (let id in this.indexes) {
      index2 = this.indexes[id];
      if (existIndex <= index2) {
        this.indexes[id] = index2 + nodes.length;
      }
    }
    this.markDirty();
    return this;
  }
  normalize(nodes, sample) {
    if (typeof nodes === "string") {
      nodes = cleanSource(parse$4(nodes).nodes);
    } else if (typeof nodes === "undefined") {
      nodes = [];
    } else if (Array.isArray(nodes)) {
      nodes = nodes.slice(0);
      for (let i2 of nodes) {
        if (i2.parent) i2.parent.removeChild(i2, "ignore");
      }
    } else if (nodes.type === "root" && this.type !== "document") {
      nodes = nodes.nodes.slice(0);
      for (let i2 of nodes) {
        if (i2.parent) i2.parent.removeChild(i2, "ignore");
      }
    } else if (nodes.type) {
      nodes = [nodes];
    } else if (nodes.prop) {
      if (typeof nodes.value === "undefined") {
        throw new Error("Value field is missed in node creation");
      } else if (typeof nodes.value !== "string") {
        nodes.value = String(nodes.value);
      }
      nodes = [new Declaration$3(nodes)];
    } else if (nodes.selector) {
      nodes = [new Rule$4(nodes)];
    } else if (nodes.name) {
      nodes = [new AtRule$4(nodes)];
    } else if (nodes.text) {
      nodes = [new Comment$3(nodes)];
    } else {
      throw new Error("Unknown node type in node creation");
    }
    let processed = nodes.map((i2) => {
      if (!i2[my$1]) Container2.rebuild(i2);
      i2 = i2.proxyOf;
      if (i2.parent) i2.parent.removeChild(i2);
      if (i2[isClean$1]) markDirtyUp(i2);
      if (typeof i2.raws.before === "undefined") {
        if (sample && typeof sample.raws.before !== "undefined") {
          i2.raws.before = sample.raws.before.replace(/\S/g, "");
        }
      }
      i2.parent = this.proxyOf;
      return i2;
    });
    return processed;
  }
  prepend(...children2) {
    children2 = children2.reverse();
    for (let child of children2) {
      let nodes = this.normalize(child, this.first, "prepend").reverse();
      for (let node2 of nodes) this.proxyOf.nodes.unshift(node2);
      for (let id in this.indexes) {
        this.indexes[id] = this.indexes[id] + nodes.length;
      }
    }
    this.markDirty();
    return this;
  }
  push(child) {
    child.parent = this;
    this.proxyOf.nodes.push(child);
    return this;
  }
  removeAll() {
    for (let node2 of this.proxyOf.nodes) node2.parent = void 0;
    this.proxyOf.nodes = [];
    this.markDirty();
    return this;
  }
  removeChild(child) {
    child = this.index(child);
    this.proxyOf.nodes[child].parent = void 0;
    this.proxyOf.nodes.splice(child, 1);
    let index2;
    for (let id in this.indexes) {
      index2 = this.indexes[id];
      if (index2 >= child) {
        this.indexes[id] = index2 - 1;
      }
    }
    this.markDirty();
    return this;
  }
  replaceValues(pattern, opts, callback) {
    if (!callback) {
      callback = opts;
      opts = {};
    }
    this.walkDecls((decl) => {
      if (opts.props && !opts.props.includes(decl.prop)) return;
      if (opts.fast && !decl.value.includes(opts.fast)) return;
      decl.value = decl.value.replace(pattern, callback);
    });
    this.markDirty();
    return this;
  }
  some(condition) {
    return this.nodes.some(condition);
  }
  walk(callback) {
    return this.each((child, i2) => {
      let result2;
      try {
        result2 = callback(child, i2);
      } catch (e2) {
        throw child.addToError(e2);
      }
      if (result2 !== false && child.walk) {
        result2 = child.walk(callback);
      }
      return result2;
    });
  }
  walkAtRules(name, callback) {
    if (!callback) {
      callback = name;
      return this.walk((child, i2) => {
        if (child.type === "atrule") {
          return callback(child, i2);
        }
      });
    }
    if (name instanceof RegExp) {
      return this.walk((child, i2) => {
        if (child.type === "atrule" && name.test(child.name)) {
          return callback(child, i2);
        }
      });
    }
    return this.walk((child, i2) => {
      if (child.type === "atrule" && child.name === name) {
        return callback(child, i2);
      }
    });
  }
  walkComments(callback) {
    return this.walk((child, i2) => {
      if (child.type === "comment") {
        return callback(child, i2);
      }
    });
  }
  walkDecls(prop, callback) {
    if (!callback) {
      callback = prop;
      return this.walk((child, i2) => {
        if (child.type === "decl") {
          return callback(child, i2);
        }
      });
    }
    if (prop instanceof RegExp) {
      return this.walk((child, i2) => {
        if (child.type === "decl" && prop.test(child.prop)) {
          return callback(child, i2);
        }
      });
    }
    return this.walk((child, i2) => {
      if (child.type === "decl" && child.prop === prop) {
        return callback(child, i2);
      }
    });
  }
  walkRules(selector, callback) {
    if (!callback) {
      callback = selector;
      return this.walk((child, i2) => {
        if (child.type === "rule") {
          return callback(child, i2);
        }
      });
    }
    if (selector instanceof RegExp) {
      return this.walk((child, i2) => {
        if (child.type === "rule" && selector.test(child.selector)) {
          return callback(child, i2);
        }
      });
    }
    return this.walk((child, i2) => {
      if (child.type === "rule" && child.selector === selector) {
        return callback(child, i2);
      }
    });
  }
  get first() {
    if (!this.proxyOf.nodes) return void 0;
    return this.proxyOf.nodes[0];
  }
  get last() {
    if (!this.proxyOf.nodes) return void 0;
    return this.proxyOf.nodes[this.proxyOf.nodes.length - 1];
  }
};
Container$7.registerParse = (dependant) => {
  parse$4 = dependant;
};
Container$7.registerRule = (dependant) => {
  Rule$4 = dependant;
};
Container$7.registerAtRule = (dependant) => {
  AtRule$4 = dependant;
};
Container$7.registerRoot = (dependant) => {
  Root$6 = dependant;
};
var container = Container$7;
Container$7.default = Container$7;
Container$7.rebuild = (node2) => {
  if (node2.type === "atrule") {
    Object.setPrototypeOf(node2, AtRule$4.prototype);
  } else if (node2.type === "rule") {
    Object.setPrototypeOf(node2, Rule$4.prototype);
  } else if (node2.type === "decl") {
    Object.setPrototypeOf(node2, Declaration$3.prototype);
  } else if (node2.type === "comment") {
    Object.setPrototypeOf(node2, Comment$3.prototype);
  } else if (node2.type === "root") {
    Object.setPrototypeOf(node2, Root$6.prototype);
  }
  node2[my$1] = true;
  if (node2.nodes) {
    node2.nodes.forEach((child) => {
      Container$7.rebuild(child);
    });
  }
};
let Container$6 = container;
let LazyResult$4;
let Processor$3;
let Document$3 = class Document23 extends Container$6 {
  constructor(defaults) {
    super(__spreadValues({ type: "document" }, defaults));
    if (!this.nodes) {
      this.nodes = [];
    }
  }
  toResult(opts = {}) {
    let lazy = new LazyResult$4(new Processor$3(), this, opts);
    return lazy.stringify();
  }
};
Document$3.registerLazyResult = (dependant) => {
  LazyResult$4 = dependant;
};
Document$3.registerProcessor = (dependant) => {
  Processor$3 = dependant;
};
var document$1 = Document$3;
Document$3.default = Document$3;
let printed = {};
var warnOnce$2 = function warnOnce2(message) {
  if (printed[message]) return;
  printed[message] = true;
  if (typeof console !== "undefined" && console.warn) {
    console.warn(message);
  }
};
let Warning$2 = class Warning2 {
  constructor(text2, opts = {}) {
    this.type = "warning";
    this.text = text2;
    if (opts.node && opts.node.source) {
      let range = opts.node.rangeBy(opts);
      this.line = range.start.line;
      this.column = range.start.column;
      this.endLine = range.end.line;
      this.endColumn = range.end.column;
    }
    for (let opt in opts) this[opt] = opts[opt];
  }
  toString() {
    if (this.node) {
      return this.node.error(this.text, {
        index: this.index,
        plugin: this.plugin,
        word: this.word
      }).message;
    }
    if (this.plugin) {
      return this.plugin + ": " + this.text;
    }
    return this.text;
  }
};
var warning = Warning$2;
Warning$2.default = Warning$2;
let Warning$1 = warning;
let Result$3 = class Result2 {
  constructor(processor2, root2, opts) {
    this.processor = processor2;
    this.messages = [];
    this.root = root2;
    this.opts = opts;
    this.css = void 0;
    this.map = void 0;
  }
  toString() {
    return this.css;
  }
  warn(text2, opts = {}) {
    if (!opts.plugin) {
      if (this.lastPlugin && this.lastPlugin.postcssPlugin) {
        opts.plugin = this.lastPlugin.postcssPlugin;
      }
    }
    let warning2 = new Warning$1(text2, opts);
    this.messages.push(warning2);
    return warning2;
  }
  warnings() {
    return this.messages.filter((i2) => i2.type === "warning");
  }
  get content() {
    return this.css;
  }
};
var result = Result$3;
Result$3.default = Result$3;
const SINGLE_QUOTE = "'".charCodeAt(0);
const DOUBLE_QUOTE = '"'.charCodeAt(0);
const BACKSLASH = "\\".charCodeAt(0);
const SLASH = "/".charCodeAt(0);
const NEWLINE = "\n".charCodeAt(0);
const SPACE = " ".charCodeAt(0);
const FEED = "\f".charCodeAt(0);
const TAB = "	".charCodeAt(0);
const CR = "\r".charCodeAt(0);
const OPEN_SQUARE = "[".charCodeAt(0);
const CLOSE_SQUARE = "]".charCodeAt(0);
const OPEN_PARENTHESES = "(".charCodeAt(0);
const CLOSE_PARENTHESES = ")".charCodeAt(0);
const OPEN_CURLY = "{".charCodeAt(0);
const CLOSE_CURLY = "}".charCodeAt(0);
const SEMICOLON = ";".charCodeAt(0);
const ASTERISK = "*".charCodeAt(0);
const COLON = ":".charCodeAt(0);
const AT = "@".charCodeAt(0);
const RE_AT_END = /[\t\n\f\r "#'()/;[\\\]{}]/g;
const RE_WORD_END = /[\t\n\f\r !"#'():;@[\\\]{}]|\/(?=\*)/g;
const RE_BAD_BRACKET = /.[\r\n"'(/\\]/;
const RE_HEX_ESCAPE = /[\da-f]/i;
var tokenize = function tokenizer2(input2, options = {}) {
  let css = input2.css.valueOf();
  let ignore = options.ignoreErrors;
  let code, next, quote, content, escape;
  let escaped, escapePos, prev, n2, currentToken;
  let length = css.length;
  let pos = 0;
  let buffer = [];
  let returned = [];
  function position2() {
    return pos;
  }
  function unclosed(what) {
    throw input2.error("Unclosed " + what, pos);
  }
  function endOfFile() {
    return returned.length === 0 && pos >= length;
  }
  function nextToken(opts) {
    if (returned.length) return returned.pop();
    if (pos >= length) return;
    let ignoreUnclosed = opts ? opts.ignoreUnclosed : false;
    code = css.charCodeAt(pos);
    switch (code) {
      case NEWLINE:
      case SPACE:
      case TAB:
      case CR:
      case FEED: {
        next = pos;
        do {
          next += 1;
          code = css.charCodeAt(next);
        } while (code === SPACE || code === NEWLINE || code === TAB || code === CR || code === FEED);
        currentToken = ["space", css.slice(pos, next)];
        pos = next - 1;
        break;
      }
      case OPEN_SQUARE:
      case CLOSE_SQUARE:
      case OPEN_CURLY:
      case CLOSE_CURLY:
      case COLON:
      case SEMICOLON:
      case CLOSE_PARENTHESES: {
        let controlChar = String.fromCharCode(code);
        currentToken = [controlChar, controlChar, pos];
        break;
      }
      case OPEN_PARENTHESES: {
        prev = buffer.length ? buffer.pop()[1] : "";
        n2 = css.charCodeAt(pos + 1);
        if (prev === "url" && n2 !== SINGLE_QUOTE && n2 !== DOUBLE_QUOTE && n2 !== SPACE && n2 !== NEWLINE && n2 !== TAB && n2 !== FEED && n2 !== CR) {
          next = pos;
          do {
            escaped = false;
            next = css.indexOf(")", next + 1);
            if (next === -1) {
              if (ignore || ignoreUnclosed) {
                next = pos;
                break;
              } else {
                unclosed("bracket");
              }
            }
            escapePos = next;
            while (css.charCodeAt(escapePos - 1) === BACKSLASH) {
              escapePos -= 1;
              escaped = !escaped;
            }
          } while (escaped);
          currentToken = ["brackets", css.slice(pos, next + 1), pos, next];
          pos = next;
        } else {
          next = css.indexOf(")", pos + 1);
          content = css.slice(pos, next + 1);
          if (next === -1 || RE_BAD_BRACKET.test(content)) {
            currentToken = ["(", "(", pos];
          } else {
            currentToken = ["brackets", content, pos, next];
            pos = next;
          }
        }
        break;
      }
      case SINGLE_QUOTE:
      case DOUBLE_QUOTE: {
        quote = code === SINGLE_QUOTE ? "'" : '"';
        next = pos;
        do {
          escaped = false;
          next = css.indexOf(quote, next + 1);
          if (next === -1) {
            if (ignore || ignoreUnclosed) {
              next = pos + 1;
              break;
            } else {
              unclosed("string");
            }
          }
          escapePos = next;
          while (css.charCodeAt(escapePos - 1) === BACKSLASH) {
            escapePos -= 1;
            escaped = !escaped;
          }
        } while (escaped);
        currentToken = ["string", css.slice(pos, next + 1), pos, next];
        pos = next;
        break;
      }
      case AT: {
        RE_AT_END.lastIndex = pos + 1;
        RE_AT_END.test(css);
        if (RE_AT_END.lastIndex === 0) {
          next = css.length - 1;
        } else {
          next = RE_AT_END.lastIndex - 2;
        }
        currentToken = ["at-word", css.slice(pos, next + 1), pos, next];
        pos = next;
        break;
      }
      case BACKSLASH: {
        next = pos;
        escape = true;
        while (css.charCodeAt(next + 1) === BACKSLASH) {
          next += 1;
          escape = !escape;
        }
        code = css.charCodeAt(next + 1);
        if (escape && code !== SLASH && code !== SPACE && code !== NEWLINE && code !== TAB && code !== CR && code !== FEED) {
          next += 1;
          if (RE_HEX_ESCAPE.test(css.charAt(next))) {
            while (RE_HEX_ESCAPE.test(css.charAt(next + 1))) {
              next += 1;
            }
            if (css.charCodeAt(next + 1) === SPACE) {
              next += 1;
            }
          }
        }
        currentToken = ["word", css.slice(pos, next + 1), pos, next];
        pos = next;
        break;
      }
      default: {
        if (code === SLASH && css.charCodeAt(pos + 1) === ASTERISK) {
          next = css.indexOf("*/", pos + 2) + 1;
          if (next === 0) {
            if (ignore || ignoreUnclosed) {
              next = css.length;
            } else {
              unclosed("comment");
            }
          }
          currentToken = ["comment", css.slice(pos, next + 1), pos, next];
          pos = next;
        } else {
          RE_WORD_END.lastIndex = pos + 1;
          RE_WORD_END.test(css);
          if (RE_WORD_END.lastIndex === 0) {
            next = css.length - 1;
          } else {
            next = RE_WORD_END.lastIndex - 2;
          }
          currentToken = ["word", css.slice(pos, next + 1), pos, next];
          buffer.push(currentToken);
          pos = next;
        }
        break;
      }
    }
    pos++;
    return currentToken;
  }
  function back(token) {
    returned.push(token);
  }
  return {
    back,
    endOfFile,
    nextToken,
    position: position2
  };
};
let Container$5 = container;
let AtRule$3 = class AtRule2 extends Container$5 {
  constructor(defaults) {
    super(defaults);
    this.type = "atrule";
  }
  append(...children2) {
    if (!this.proxyOf.nodes) this.nodes = [];
    return super.append(...children2);
  }
  prepend(...children2) {
    if (!this.proxyOf.nodes) this.nodes = [];
    return super.prepend(...children2);
  }
};
var atRule = AtRule$3;
AtRule$3.default = AtRule$3;
Container$5.registerAtRule(AtRule$3);
let Container$4 = container;
let LazyResult$3;
let Processor$2;
let Root$5 = class Root2 extends Container$4 {
  constructor(defaults) {
    super(defaults);
    this.type = "root";
    if (!this.nodes) this.nodes = [];
  }
  normalize(child, sample, type) {
    let nodes = super.normalize(child);
    if (sample) {
      if (type === "prepend") {
        if (this.nodes.length > 1) {
          sample.raws.before = this.nodes[1].raws.before;
        } else {
          delete sample.raws.before;
        }
      } else if (this.first !== sample) {
        for (let node2 of nodes) {
          node2.raws.before = sample.raws.before;
        }
      }
    }
    return nodes;
  }
  removeChild(child, ignore) {
    let index2 = this.index(child);
    if (!ignore && index2 === 0 && this.nodes.length > 1) {
      this.nodes[1].raws.before = this.nodes[index2].raws.before;
    }
    return super.removeChild(child);
  }
  toResult(opts = {}) {
    let lazy = new LazyResult$3(new Processor$2(), this, opts);
    return lazy.stringify();
  }
};
Root$5.registerLazyResult = (dependant) => {
  LazyResult$3 = dependant;
};
Root$5.registerProcessor = (dependant) => {
  Processor$2 = dependant;
};
var root = Root$5;
Root$5.default = Root$5;
Container$4.registerRoot(Root$5);
let list$2 = {
  comma(string) {
    return list$2.split(string, [","], true);
  },
  space(string) {
    let spaces = [" ", "\n", "	"];
    return list$2.split(string, spaces);
  },
  split(string, separators, last) {
    let array = [];
    let current = "";
    let split = false;
    let func = 0;
    let inQuote = false;
    let prevQuote = "";
    let escape = false;
    for (let letter of string) {
      if (escape) {
        escape = false;
      } else if (letter === "\\") {
        escape = true;
      } else if (inQuote) {
        if (letter === prevQuote) {
          inQuote = false;
        }
      } else if (letter === '"' || letter === "'") {
        inQuote = true;
        prevQuote = letter;
      } else if (letter === "(") {
        func += 1;
      } else if (letter === ")") {
        if (func > 0) func -= 1;
      } else if (func === 0) {
        if (separators.includes(letter)) split = true;
      }
      if (split) {
        if (current !== "") array.push(current.trim());
        current = "";
        split = false;
      } else {
        current += letter;
      }
    }
    if (last || current !== "") array.push(current.trim());
    return array;
  }
};
var list_1 = list$2;
list$2.default = list$2;
let Container$3 = container;
let list$1 = list_1;
let Rule$3 = class Rule2 extends Container$3 {
  constructor(defaults) {
    super(defaults);
    this.type = "rule";
    if (!this.nodes) this.nodes = [];
  }
  get selectors() {
    return list$1.comma(this.selector);
  }
  set selectors(values) {
    let match = this.selector ? this.selector.match(/,\s*/) : null;
    let sep2 = match ? match[0] : "," + this.raw("between", "beforeOpen");
    this.selector = values.join(sep2);
  }
};
var rule = Rule$3;
Rule$3.default = Rule$3;
Container$3.registerRule(Rule$3);
let Declaration$2 = declaration;
let tokenizer22 = tokenize;
let Comment$2 = comment;
let AtRule$2 = atRule;
let Root$4 = root;
let Rule$2 = rule;
const SAFE_COMMENT_NEIGHBOR = {
  empty: true,
  space: true
};
function findLastWithPosition(tokens) {
  for (let i2 = tokens.length - 1; i2 >= 0; i2--) {
    let token = tokens[i2];
    let pos = token[3] || token[2];
    if (pos) return pos;
  }
}
let Parser$1 = class Parser2 {
  constructor(input2) {
    this.input = input2;
    this.root = new Root$4();
    this.current = this.root;
    this.spaces = "";
    this.semicolon = false;
    this.createTokenizer();
    this.root.source = { input: input2, start: { column: 1, line: 1, offset: 0 } };
  }
  atrule(token) {
    let node2 = new AtRule$2();
    node2.name = token[1].slice(1);
    if (node2.name === "") {
      this.unnamedAtrule(node2, token);
    }
    this.init(node2, token[2]);
    let type;
    let prev;
    let shift;
    let last = false;
    let open = false;
    let params = [];
    let brackets = [];
    while (!this.tokenizer.endOfFile()) {
      token = this.tokenizer.nextToken();
      type = token[0];
      if (type === "(" || type === "[") {
        brackets.push(type === "(" ? ")" : "]");
      } else if (type === "{" && brackets.length > 0) {
        brackets.push("}");
      } else if (type === brackets[brackets.length - 1]) {
        brackets.pop();
      }
      if (brackets.length === 0) {
        if (type === ";") {
          node2.source.end = this.getPosition(token[2]);
          node2.source.end.offset++;
          this.semicolon = true;
          break;
        } else if (type === "{") {
          open = true;
          break;
        } else if (type === "}") {
          if (params.length > 0) {
            shift = params.length - 1;
            prev = params[shift];
            while (prev && prev[0] === "space") {
              prev = params[--shift];
            }
            if (prev) {
              node2.source.end = this.getPosition(prev[3] || prev[2]);
              node2.source.end.offset++;
            }
          }
          this.end(token);
          break;
        } else {
          params.push(token);
        }
      } else {
        params.push(token);
      }
      if (this.tokenizer.endOfFile()) {
        last = true;
        break;
      }
    }
    node2.raws.between = this.spacesAndCommentsFromEnd(params);
    if (params.length) {
      node2.raws.afterName = this.spacesAndCommentsFromStart(params);
      this.raw(node2, "params", params);
      if (last) {
        token = params[params.length - 1];
        node2.source.end = this.getPosition(token[3] || token[2]);
        node2.source.end.offset++;
        this.spaces = node2.raws.between;
        node2.raws.between = "";
      }
    } else {
      node2.raws.afterName = "";
      node2.params = "";
    }
    if (open) {
      node2.nodes = [];
      this.current = node2;
    }
  }
  checkMissedSemicolon(tokens) {
    let colon = this.colon(tokens);
    if (colon === false) return;
    let founded = 0;
    let token;
    for (let j = colon - 1; j >= 0; j--) {
      token = tokens[j];
      if (token[0] !== "space") {
        founded += 1;
        if (founded === 2) break;
      }
    }
    throw this.input.error(
      "Missed semicolon",
      token[0] === "word" ? token[3] + 1 : token[2]
    );
  }
  colon(tokens) {
    let brackets = 0;
    let token, type, prev;
    for (let [i2, element2] of tokens.entries()) {
      token = element2;
      type = token[0];
      if (type === "(") {
        brackets += 1;
      }
      if (type === ")") {
        brackets -= 1;
      }
      if (brackets === 0 && type === ":") {
        if (!prev) {
          this.doubleColon(token);
        } else if (prev[0] === "word" && prev[1] === "progid") {
          continue;
        } else {
          return i2;
        }
      }
      prev = token;
    }
    return false;
  }
  comment(token) {
    let node2 = new Comment$2();
    this.init(node2, token[2]);
    node2.source.end = this.getPosition(token[3] || token[2]);
    node2.source.end.offset++;
    let text2 = token[1].slice(2, -2);
    if (/^\s*$/.test(text2)) {
      node2.text = "";
      node2.raws.left = text2;
      node2.raws.right = "";
    } else {
      let match = text2.match(/^(\s*)([^]*\S)(\s*)$/);
      node2.text = match[2];
      node2.raws.left = match[1];
      node2.raws.right = match[3];
    }
  }
  createTokenizer() {
    this.tokenizer = tokenizer22(this.input);
  }
  decl(tokens, customProperty) {
    let node2 = new Declaration$2();
    this.init(node2, tokens[0][2]);
    let last = tokens[tokens.length - 1];
    if (last[0] === ";") {
      this.semicolon = true;
      tokens.pop();
    }
    node2.source.end = this.getPosition(
      last[3] || last[2] || findLastWithPosition(tokens)
    );
    node2.source.end.offset++;
    while (tokens[0][0] !== "word") {
      if (tokens.length === 1) this.unknownWord(tokens);
      node2.raws.before += tokens.shift()[1];
    }
    node2.source.start = this.getPosition(tokens[0][2]);
    node2.prop = "";
    while (tokens.length) {
      let type = tokens[0][0];
      if (type === ":" || type === "space" || type === "comment") {
        break;
      }
      node2.prop += tokens.shift()[1];
    }
    node2.raws.between = "";
    let token;
    while (tokens.length) {
      token = tokens.shift();
      if (token[0] === ":") {
        node2.raws.between += token[1];
        break;
      } else {
        if (token[0] === "word" && /\w/.test(token[1])) {
          this.unknownWord([token]);
        }
        node2.raws.between += token[1];
      }
    }
    if (node2.prop[0] === "_" || node2.prop[0] === "*") {
      node2.raws.before += node2.prop[0];
      node2.prop = node2.prop.slice(1);
    }
    let firstSpaces = [];
    let next;
    while (tokens.length) {
      next = tokens[0][0];
      if (next !== "space" && next !== "comment") break;
      firstSpaces.push(tokens.shift());
    }
    this.precheckMissedSemicolon(tokens);
    for (let i2 = tokens.length - 1; i2 >= 0; i2--) {
      token = tokens[i2];
      if (token[1].toLowerCase() === "!important") {
        node2.important = true;
        let string = this.stringFrom(tokens, i2);
        string = this.spacesFromEnd(tokens) + string;
        if (string !== " !important") node2.raws.important = string;
        break;
      } else if (token[1].toLowerCase() === "important") {
        let cache = tokens.slice(0);
        let str = "";
        for (let j = i2; j > 0; j--) {
          let type = cache[j][0];
          if (str.trim().indexOf("!") === 0 && type !== "space") {
            break;
          }
          str = cache.pop()[1] + str;
        }
        if (str.trim().indexOf("!") === 0) {
          node2.important = true;
          node2.raws.important = str;
          tokens = cache;
        }
      }
      if (token[0] !== "space" && token[0] !== "comment") {
        break;
      }
    }
    let hasWord = tokens.some((i2) => i2[0] !== "space" && i2[0] !== "comment");
    if (hasWord) {
      node2.raws.between += firstSpaces.map((i2) => i2[1]).join("");
      firstSpaces = [];
    }
    this.raw(node2, "value", firstSpaces.concat(tokens), customProperty);
    if (node2.value.includes(":") && !customProperty) {
      this.checkMissedSemicolon(tokens);
    }
  }
  doubleColon(token) {
    throw this.input.error(
      "Double colon",
      { offset: token[2] },
      { offset: token[2] + token[1].length }
    );
  }
  emptyRule(token) {
    let node2 = new Rule$2();
    this.init(node2, token[2]);
    node2.selector = "";
    node2.raws.between = "";
    this.current = node2;
  }
  end(token) {
    if (this.current.nodes && this.current.nodes.length) {
      this.current.raws.semicolon = this.semicolon;
    }
    this.semicolon = false;
    this.current.raws.after = (this.current.raws.after || "") + this.spaces;
    this.spaces = "";
    if (this.current.parent) {
      this.current.source.end = this.getPosition(token[2]);
      this.current.source.end.offset++;
      this.current = this.current.parent;
    } else {
      this.unexpectedClose(token);
    }
  }
  endFile() {
    if (this.current.parent) this.unclosedBlock();
    if (this.current.nodes && this.current.nodes.length) {
      this.current.raws.semicolon = this.semicolon;
    }
    this.current.raws.after = (this.current.raws.after || "") + this.spaces;
    this.root.source.end = this.getPosition(this.tokenizer.position());
  }
  freeSemicolon(token) {
    this.spaces += token[1];
    if (this.current.nodes) {
      let prev = this.current.nodes[this.current.nodes.length - 1];
      if (prev && prev.type === "rule" && !prev.raws.ownSemicolon) {
        prev.raws.ownSemicolon = this.spaces;
        this.spaces = "";
      }
    }
  }
  // Helpers
  getPosition(offset) {
    let pos = this.input.fromOffset(offset);
    return {
      column: pos.col,
      line: pos.line,
      offset
    };
  }
  init(node2, offset) {
    this.current.push(node2);
    node2.source = {
      input: this.input,
      start: this.getPosition(offset)
    };
    node2.raws.before = this.spaces;
    this.spaces = "";
    if (node2.type !== "comment") this.semicolon = false;
  }
  other(start) {
    let end = false;
    let type = null;
    let colon = false;
    let bracket = null;
    let brackets = [];
    let customProperty = start[1].startsWith("--");
    let tokens = [];
    let token = start;
    while (token) {
      type = token[0];
      tokens.push(token);
      if (type === "(" || type === "[") {
        if (!bracket) bracket = token;
        brackets.push(type === "(" ? ")" : "]");
      } else if (customProperty && colon && type === "{") {
        if (!bracket) bracket = token;
        brackets.push("}");
      } else if (brackets.length === 0) {
        if (type === ";") {
          if (colon) {
            this.decl(tokens, customProperty);
            return;
          } else {
            break;
          }
        } else if (type === "{") {
          this.rule(tokens);
          return;
        } else if (type === "}") {
          this.tokenizer.back(tokens.pop());
          end = true;
          break;
        } else if (type === ":") {
          colon = true;
        }
      } else if (type === brackets[brackets.length - 1]) {
        brackets.pop();
        if (brackets.length === 0) bracket = null;
      }
      token = this.tokenizer.nextToken();
    }
    if (this.tokenizer.endOfFile()) end = true;
    if (brackets.length > 0) this.unclosedBracket(bracket);
    if (end && colon) {
      if (!customProperty) {
        while (tokens.length) {
          token = tokens[tokens.length - 1][0];
          if (token !== "space" && token !== "comment") break;
          this.tokenizer.back(tokens.pop());
        }
      }
      this.decl(tokens, customProperty);
    } else {
      this.unknownWord(tokens);
    }
  }
  parse() {
    let token;
    while (!this.tokenizer.endOfFile()) {
      token = this.tokenizer.nextToken();
      switch (token[0]) {
        case "space":
          this.spaces += token[1];
          break;
        case ";":
          this.freeSemicolon(token);
          break;
        case "}":
          this.end(token);
          break;
        case "comment":
          this.comment(token);
          break;
        case "at-word":
          this.atrule(token);
          break;
        case "{":
          this.emptyRule(token);
          break;
        default:
          this.other(token);
          break;
      }
    }
    this.endFile();
  }
  precheckMissedSemicolon() {
  }
  raw(node2, prop, tokens, customProperty) {
    let token, type;
    let length = tokens.length;
    let value = "";
    let clean = true;
    let next, prev;
    for (let i2 = 0; i2 < length; i2 += 1) {
      token = tokens[i2];
      type = token[0];
      if (type === "space" && i2 === length - 1 && !customProperty) {
        clean = false;
      } else if (type === "comment") {
        prev = tokens[i2 - 1] ? tokens[i2 - 1][0] : "empty";
        next = tokens[i2 + 1] ? tokens[i2 + 1][0] : "empty";
        if (!SAFE_COMMENT_NEIGHBOR[prev] && !SAFE_COMMENT_NEIGHBOR[next]) {
          if (value.slice(-1) === ",") {
            clean = false;
          } else {
            value += token[1];
          }
        } else {
          clean = false;
        }
      } else {
        value += token[1];
      }
    }
    if (!clean) {
      let raw = tokens.reduce((all, i2) => all + i2[1], "");
      node2.raws[prop] = { raw, value };
    }
    node2[prop] = value;
  }
  rule(tokens) {
    tokens.pop();
    let node2 = new Rule$2();
    this.init(node2, tokens[0][2]);
    node2.raws.between = this.spacesAndCommentsFromEnd(tokens);
    this.raw(node2, "selector", tokens);
    this.current = node2;
  }
  spacesAndCommentsFromEnd(tokens) {
    let lastTokenType;
    let spaces = "";
    while (tokens.length) {
      lastTokenType = tokens[tokens.length - 1][0];
      if (lastTokenType !== "space" && lastTokenType !== "comment") break;
      spaces = tokens.pop()[1] + spaces;
    }
    return spaces;
  }
  // Errors
  spacesAndCommentsFromStart(tokens) {
    let next;
    let spaces = "";
    while (tokens.length) {
      next = tokens[0][0];
      if (next !== "space" && next !== "comment") break;
      spaces += tokens.shift()[1];
    }
    return spaces;
  }
  spacesFromEnd(tokens) {
    let lastTokenType;
    let spaces = "";
    while (tokens.length) {
      lastTokenType = tokens[tokens.length - 1][0];
      if (lastTokenType !== "space") break;
      spaces = tokens.pop()[1] + spaces;
    }
    return spaces;
  }
  stringFrom(tokens, from) {
    let result2 = "";
    for (let i2 = from; i2 < tokens.length; i2++) {
      result2 += tokens[i2][1];
    }
    tokens.splice(from, tokens.length - from);
    return result2;
  }
  unclosedBlock() {
    let pos = this.current.source.start;
    throw this.input.error("Unclosed block", pos.line, pos.column);
  }
  unclosedBracket(bracket) {
    throw this.input.error(
      "Unclosed bracket",
      { offset: bracket[2] },
      { offset: bracket[2] + 1 }
    );
  }
  unexpectedClose(token) {
    throw this.input.error(
      "Unexpected }",
      { offset: token[2] },
      { offset: token[2] + 1 }
    );
  }
  unknownWord(tokens) {
    throw this.input.error(
      "Unknown word",
      { offset: tokens[0][2] },
      { offset: tokens[0][2] + tokens[0][1].length }
    );
  }
  unnamedAtrule(node2, token) {
    throw this.input.error(
      "At-rule without name",
      { offset: token[2] },
      { offset: token[2] + token[1].length }
    );
  }
};
var parser = Parser$1;
let Container$2 = container;
let Parser22 = parser;
let Input$2 = input;
function parse$3(css, opts) {
  let input2 = new Input$2(css, opts);
  let parser2 = new Parser22(input2);
  try {
    parser2.parse();
  } catch (e2) {
    if (true) {
      if (e2.name === "CssSyntaxError" && opts && opts.from) {
        if (/\.scss$/i.test(opts.from)) {
          e2.message += "\nYou tried to parse SCSS with the standard CSS parser; try again with the postcss-scss parser";
        } else if (/\.sass/i.test(opts.from)) {
          e2.message += "\nYou tried to parse Sass with the standard CSS parser; try again with the postcss-sass parser";
        } else if (/\.less$/i.test(opts.from)) {
          e2.message += "\nYou tried to parse Less with the standard CSS parser; try again with the postcss-less parser";
        }
      }
    }
    throw e2;
  }
  return parser2.root;
}
var parse_1 = parse$3;
parse$3.default = parse$3;
Container$2.registerParse(parse$3);
let { isClean, my } = symbols;
let MapGenerator$1 = mapGenerator;
let stringify$2 = stringify_1;
let Container$1 = container;
let Document$2 = document$1;
let warnOnce$1 = warnOnce$2;
let Result$2 = result;
let parse$2 = parse_1;
let Root$3 = root;
const TYPE_TO_CLASS_NAME = {
  atrule: "AtRule",
  comment: "Comment",
  decl: "Declaration",
  document: "Document",
  root: "Root",
  rule: "Rule"
};
const PLUGIN_PROPS = {
  AtRule: true,
  AtRuleExit: true,
  Comment: true,
  CommentExit: true,
  Declaration: true,
  DeclarationExit: true,
  Document: true,
  DocumentExit: true,
  Once: true,
  OnceExit: true,
  postcssPlugin: true,
  prepare: true,
  Root: true,
  RootExit: true,
  Rule: true,
  RuleExit: true
};
const NOT_VISITORS = {
  Once: true,
  postcssPlugin: true,
  prepare: true
};
const CHILDREN = 0;
function isPromise(obj) {
  return typeof obj === "object" && typeof obj.then === "function";
}
function getEvents(node2) {
  let key = false;
  let type = TYPE_TO_CLASS_NAME[node2.type];
  if (node2.type === "decl") {
    key = node2.prop.toLowerCase();
  } else if (node2.type === "atrule") {
    key = node2.name.toLowerCase();
  }
  if (key && node2.append) {
    return [
      type,
      type + "-" + key,
      CHILDREN,
      type + "Exit",
      type + "Exit-" + key
    ];
  } else if (key) {
    return [type, type + "-" + key, type + "Exit", type + "Exit-" + key];
  } else if (node2.append) {
    return [type, CHILDREN, type + "Exit"];
  } else {
    return [type, type + "Exit"];
  }
}
function toStack(node2) {
  let events;
  if (node2.type === "document") {
    events = ["Document", CHILDREN, "DocumentExit"];
  } else if (node2.type === "root") {
    events = ["Root", CHILDREN, "RootExit"];
  } else {
    events = getEvents(node2);
  }
  return {
    eventIndex: 0,
    events,
    iterator: 0,
    node: node2,
    visitorIndex: 0,
    visitors: []
  };
}
function cleanMarks(node2) {
  node2[isClean] = false;
  if (node2.nodes) node2.nodes.forEach((i2) => cleanMarks(i2));
  return node2;
}
let postcss$2 = {};
let LazyResult$2 = class LazyResult2 {
  constructor(processor2, css, opts) {
    this.stringified = false;
    this.processed = false;
    let root2;
    if (typeof css === "object" && css !== null && (css.type === "root" || css.type === "document")) {
      root2 = cleanMarks(css);
    } else if (css instanceof LazyResult2 || css instanceof Result$2) {
      root2 = cleanMarks(css.root);
      if (css.map) {
        if (typeof opts.map === "undefined") opts.map = {};
        if (!opts.map.inline) opts.map.inline = false;
        opts.map.prev = css.map;
      }
    } else {
      let parser2 = parse$2;
      if (opts.syntax) parser2 = opts.syntax.parse;
      if (opts.parser) parser2 = opts.parser;
      if (parser2.parse) parser2 = parser2.parse;
      try {
        root2 = parser2(css, opts);
      } catch (error) {
        this.processed = true;
        this.error = error;
      }
      if (root2 && !root2[my]) {
        Container$1.rebuild(root2);
      }
    }
    this.result = new Result$2(processor2, root2, opts);
    this.helpers = __spreadProps(__spreadValues({}, postcss$2), { postcss: postcss$2, result: this.result });
    this.plugins = this.processor.plugins.map((plugin22) => {
      if (typeof plugin22 === "object" && plugin22.prepare) {
        return __spreadValues(__spreadValues({}, plugin22), plugin22.prepare(this.result));
      } else {
        return plugin22;
      }
    });
  }
  async() {
    if (this.error) return Promise.reject(this.error);
    if (this.processed) return Promise.resolve(this.result);
    if (!this.processing) {
      this.processing = this.runAsync();
    }
    return this.processing;
  }
  catch(onRejected) {
    return this.async().catch(onRejected);
  }
  finally(onFinally) {
    return this.async().then(onFinally, onFinally);
  }
  getAsyncError() {
    throw new Error("Use process(css).then(cb) to work with async plugins");
  }
  handleError(error, node2) {
    let plugin22 = this.result.lastPlugin;
    try {
      if (node2) node2.addToError(error);
      this.error = error;
      if (error.name === "CssSyntaxError" && !error.plugin) {
        error.plugin = plugin22.postcssPlugin;
        error.setMessage();
      } else if (plugin22.postcssVersion) {
        if (true) {
          let pluginName = plugin22.postcssPlugin;
          let pluginVer = plugin22.postcssVersion;
          let runtimeVer = this.result.processor.version;
          let a2 = pluginVer.split(".");
          let b = runtimeVer.split(".");
          if (a2[0] !== b[0] || parseInt(a2[1]) > parseInt(b[1])) {
            console.error(
              "Unknown error from PostCSS plugin. Your current PostCSS version is " + runtimeVer + ", but " + pluginName + " uses " + pluginVer + ". Perhaps this is the source of the error below."
            );
          }
        }
      }
    } catch (err) {
      if (console && console.error) console.error(err);
    }
    return error;
  }
  prepareVisitors() {
    this.listeners = {};
    let add = (plugin22, type, cb) => {
      if (!this.listeners[type]) this.listeners[type] = [];
      this.listeners[type].push([plugin22, cb]);
    };
    for (let plugin22 of this.plugins) {
      if (typeof plugin22 === "object") {
        for (let event in plugin22) {
          if (!PLUGIN_PROPS[event] && /^[A-Z]/.test(event)) {
            throw new Error(
              `Unknown event ${event} in ${plugin22.postcssPlugin}. Try to update PostCSS (${this.processor.version} now).`
            );
          }
          if (!NOT_VISITORS[event]) {
            if (typeof plugin22[event] === "object") {
              for (let filter in plugin22[event]) {
                if (filter === "*") {
                  add(plugin22, event, plugin22[event][filter]);
                } else {
                  add(
                    plugin22,
                    event + "-" + filter.toLowerCase(),
                    plugin22[event][filter]
                  );
                }
              }
            } else if (typeof plugin22[event] === "function") {
              add(plugin22, event, plugin22[event]);
            }
          }
        }
      }
    }
    this.hasListener = Object.keys(this.listeners).length > 0;
  }
  async runAsync() {
    this.plugin = 0;
    for (let i2 = 0; i2 < this.plugins.length; i2++) {
      let plugin22 = this.plugins[i2];
      let promise = this.runOnRoot(plugin22);
      if (isPromise(promise)) {
        try {
          await promise;
        } catch (error) {
          throw this.handleError(error);
        }
      }
    }
    this.prepareVisitors();
    if (this.hasListener) {
      let root2 = this.result.root;
      while (!root2[isClean]) {
        root2[isClean] = true;
        let stack = [toStack(root2)];
        while (stack.length > 0) {
          let promise = this.visitTick(stack);
          if (isPromise(promise)) {
            try {
              await promise;
            } catch (e2) {
              let node2 = stack[stack.length - 1].node;
              throw this.handleError(e2, node2);
            }
          }
        }
      }
      if (this.listeners.OnceExit) {
        for (let [plugin22, visitor] of this.listeners.OnceExit) {
          this.result.lastPlugin = plugin22;
          try {
            if (root2.type === "document") {
              let roots = root2.nodes.map(
                (subRoot) => visitor(subRoot, this.helpers)
              );
              await Promise.all(roots);
            } else {
              await visitor(root2, this.helpers);
            }
          } catch (e2) {
            throw this.handleError(e2);
          }
        }
      }
    }
    this.processed = true;
    return this.stringify();
  }
  runOnRoot(plugin22) {
    this.result.lastPlugin = plugin22;
    try {
      if (typeof plugin22 === "object" && plugin22.Once) {
        if (this.result.root.type === "document") {
          let roots = this.result.root.nodes.map(
            (root2) => plugin22.Once(root2, this.helpers)
          );
          if (isPromise(roots[0])) {
            return Promise.all(roots);
          }
          return roots;
        }
        return plugin22.Once(this.result.root, this.helpers);
      } else if (typeof plugin22 === "function") {
        return plugin22(this.result.root, this.result);
      }
    } catch (error) {
      throw this.handleError(error);
    }
  }
  stringify() {
    if (this.error) throw this.error;
    if (this.stringified) return this.result;
    this.stringified = true;
    this.sync();
    let opts = this.result.opts;
    let str = stringify$2;
    if (opts.syntax) str = opts.syntax.stringify;
    if (opts.stringifier) str = opts.stringifier;
    if (str.stringify) str = str.stringify;
    let map = new MapGenerator$1(str, this.result.root, this.result.opts);
    let data = map.generate();
    this.result.css = data[0];
    this.result.map = data[1];
    return this.result;
  }
  sync() {
    if (this.error) throw this.error;
    if (this.processed) return this.result;
    this.processed = true;
    if (this.processing) {
      throw this.getAsyncError();
    }
    for (let plugin22 of this.plugins) {
      let promise = this.runOnRoot(plugin22);
      if (isPromise(promise)) {
        throw this.getAsyncError();
      }
    }
    this.prepareVisitors();
    if (this.hasListener) {
      let root2 = this.result.root;
      while (!root2[isClean]) {
        root2[isClean] = true;
        this.walkSync(root2);
      }
      if (this.listeners.OnceExit) {
        if (root2.type === "document") {
          for (let subRoot of root2.nodes) {
            this.visitSync(this.listeners.OnceExit, subRoot);
          }
        } else {
          this.visitSync(this.listeners.OnceExit, root2);
        }
      }
    }
    return this.result;
  }
  then(onFulfilled, onRejected) {
    if (true) {
      if (!("from" in this.opts)) {
        warnOnce$1(
          "Without `from` option PostCSS could generate wrong source map and will not find Browserslist config. Set it to CSS file path or to `undefined` to prevent this warning."
        );
      }
    }
    return this.async().then(onFulfilled, onRejected);
  }
  toString() {
    return this.css;
  }
  visitSync(visitors, node2) {
    for (let [plugin22, visitor] of visitors) {
      this.result.lastPlugin = plugin22;
      let promise;
      try {
        promise = visitor(node2, this.helpers);
      } catch (e2) {
        throw this.handleError(e2, node2.proxyOf);
      }
      if (node2.type !== "root" && node2.type !== "document" && !node2.parent) {
        return true;
      }
      if (isPromise(promise)) {
        throw this.getAsyncError();
      }
    }
  }
  visitTick(stack) {
    let visit2 = stack[stack.length - 1];
    let { node: node2, visitors } = visit2;
    if (node2.type !== "root" && node2.type !== "document" && !node2.parent) {
      stack.pop();
      return;
    }
    if (visitors.length > 0 && visit2.visitorIndex < visitors.length) {
      let [plugin22, visitor] = visitors[visit2.visitorIndex];
      visit2.visitorIndex += 1;
      if (visit2.visitorIndex === visitors.length) {
        visit2.visitors = [];
        visit2.visitorIndex = 0;
      }
      this.result.lastPlugin = plugin22;
      try {
        return visitor(node2.toProxy(), this.helpers);
      } catch (e2) {
        throw this.handleError(e2, node2);
      }
    }
    if (visit2.iterator !== 0) {
      let iterator = visit2.iterator;
      let child;
      while (child = node2.nodes[node2.indexes[iterator]]) {
        node2.indexes[iterator] += 1;
        if (!child[isClean]) {
          child[isClean] = true;
          stack.push(toStack(child));
          return;
        }
      }
      visit2.iterator = 0;
      delete node2.indexes[iterator];
    }
    let events = visit2.events;
    while (visit2.eventIndex < events.length) {
      let event = events[visit2.eventIndex];
      visit2.eventIndex += 1;
      if (event === CHILDREN) {
        if (node2.nodes && node2.nodes.length) {
          node2[isClean] = true;
          visit2.iterator = node2.getIterator();
        }
        return;
      } else if (this.listeners[event]) {
        visit2.visitors = this.listeners[event];
        return;
      }
    }
    stack.pop();
  }
  walkSync(node2) {
    node2[isClean] = true;
    let events = getEvents(node2);
    for (let event of events) {
      if (event === CHILDREN) {
        if (node2.nodes) {
          node2.each((child) => {
            if (!child[isClean]) this.walkSync(child);
          });
        }
      } else {
        let visitors = this.listeners[event];
        if (visitors) {
          if (this.visitSync(visitors, node2.toProxy())) return;
        }
      }
    }
  }
  warnings() {
    return this.sync().warnings();
  }
  get content() {
    return this.stringify().content;
  }
  get css() {
    return this.stringify().css;
  }
  get map() {
    return this.stringify().map;
  }
  get messages() {
    return this.sync().messages;
  }
  get opts() {
    return this.result.opts;
  }
  get processor() {
    return this.result.processor;
  }
  get root() {
    return this.sync().root;
  }
  get [Symbol.toStringTag]() {
    return "LazyResult";
  }
};
LazyResult$2.registerPostcss = (dependant) => {
  postcss$2 = dependant;
};
var lazyResult = LazyResult$2;
LazyResult$2.default = LazyResult$2;
Root$3.registerLazyResult(LazyResult$2);
Document$2.registerLazyResult(LazyResult$2);
let MapGenerator22 = mapGenerator;
let stringify$1 = stringify_1;
let warnOnce22 = warnOnce$2;
let parse$1 = parse_1;
const Result$1 = result;
let NoWorkResult$1 = class NoWorkResult2 {
  constructor(processor2, css, opts) {
    css = css.toString();
    this.stringified = false;
    this._processor = processor2;
    this._css = css;
    this._opts = opts;
    this._map = void 0;
    let root2;
    let str = stringify$1;
    this.result = new Result$1(this._processor, root2, this._opts);
    this.result.css = css;
    let self = this;
    Object.defineProperty(this.result, "root", {
      get() {
        return self.root;
      }
    });
    let map = new MapGenerator22(str, root2, this._opts, css);
    if (map.isMap()) {
      let [generatedCSS, generatedMap] = map.generate();
      if (generatedCSS) {
        this.result.css = generatedCSS;
      }
      if (generatedMap) {
        this.result.map = generatedMap;
      }
    } else {
      map.clearAnnotation();
      this.result.css = map.css;
    }
  }
  async() {
    if (this.error) return Promise.reject(this.error);
    return Promise.resolve(this.result);
  }
  catch(onRejected) {
    return this.async().catch(onRejected);
  }
  finally(onFinally) {
    return this.async().then(onFinally, onFinally);
  }
  sync() {
    if (this.error) throw this.error;
    return this.result;
  }
  then(onFulfilled, onRejected) {
    if (true) {
      if (!("from" in this._opts)) {
        warnOnce22(
          "Without `from` option PostCSS could generate wrong source map and will not find Browserslist config. Set it to CSS file path or to `undefined` to prevent this warning."
        );
      }
    }
    return this.async().then(onFulfilled, onRejected);
  }
  toString() {
    return this._css;
  }
  warnings() {
    return [];
  }
  get content() {
    return this.result.css;
  }
  get css() {
    return this.result.css;
  }
  get map() {
    return this.result.map;
  }
  get messages() {
    return [];
  }
  get opts() {
    return this.result.opts;
  }
  get processor() {
    return this.result.processor;
  }
  get root() {
    if (this._root) {
      return this._root;
    }
    let root2;
    let parser2 = parse$1;
    try {
      root2 = parser2(this._css, this._opts);
    } catch (error) {
      this.error = error;
    }
    if (this.error) {
      throw this.error;
    } else {
      this._root = root2;
      return root2;
    }
  }
  get [Symbol.toStringTag]() {
    return "NoWorkResult";
  }
};
var noWorkResult = NoWorkResult$1;
NoWorkResult$1.default = NoWorkResult$1;
let NoWorkResult22 = noWorkResult;
let LazyResult$1 = lazyResult;
let Document$1 = document$1;
let Root$2 = root;
let Processor$1 = class Processor2 {
  constructor(plugins = []) {
    this.version = "8.4.38";
    this.plugins = this.normalize(plugins);
  }
  normalize(plugins) {
    let normalized = [];
    for (let i2 of plugins) {
      if (i2.postcss === true) {
        i2 = i2();
      } else if (i2.postcss) {
        i2 = i2.postcss;
      }
      if (typeof i2 === "object" && Array.isArray(i2.plugins)) {
        normalized = normalized.concat(i2.plugins);
      } else if (typeof i2 === "object" && i2.postcssPlugin) {
        normalized.push(i2);
      } else if (typeof i2 === "function") {
        normalized.push(i2);
      } else if (typeof i2 === "object" && (i2.parse || i2.stringify)) {
        if (true) {
          throw new Error(
            "PostCSS syntaxes cannot be used as plugins. Instead, please use one of the syntax/parser/stringifier options as outlined in your PostCSS runner documentation."
          );
        }
      } else {
        throw new Error(i2 + " is not a PostCSS plugin");
      }
    }
    return normalized;
  }
  process(css, opts = {}) {
    if (!this.plugins.length && !opts.parser && !opts.stringifier && !opts.syntax) {
      return new NoWorkResult22(this, css, opts);
    } else {
      return new LazyResult$1(this, css, opts);
    }
  }
  use(plugin22) {
    this.plugins = this.plugins.concat(this.normalize([plugin22]));
    return this;
  }
};
var processor = Processor$1;
Processor$1.default = Processor$1;
Root$2.registerProcessor(Processor$1);
Document$1.registerProcessor(Processor$1);
let Declaration$1 = declaration;
let PreviousMap22 = previousMap;
let Comment$1 = comment;
let AtRule$1 = atRule;
let Input$1 = input;
let Root$1 = root;
let Rule$1 = rule;
function fromJSON$1(json, inputs) {
  if (Array.isArray(json)) return json.map((n2) => fromJSON$1(n2));
  let _a2 = json, { inputs: ownInputs } = _a2, defaults = __objRest(_a2, ["inputs"]);
  if (ownInputs) {
    inputs = [];
    for (let input2 of ownInputs) {
      let inputHydrated = __spreadProps(__spreadValues({}, input2), { __proto__: Input$1.prototype });
      if (inputHydrated.map) {
        inputHydrated.map = __spreadProps(__spreadValues({}, inputHydrated.map), {
          __proto__: PreviousMap22.prototype
        });
      }
      inputs.push(inputHydrated);
    }
  }
  if (defaults.nodes) {
    defaults.nodes = json.nodes.map((n2) => fromJSON$1(n2, inputs));
  }
  if (defaults.source) {
    let _b2 = defaults.source, { inputId } = _b2, source = __objRest(_b2, ["inputId"]);
    defaults.source = source;
    if (inputId != null) {
      defaults.source.input = inputs[inputId];
    }
  }
  if (defaults.type === "root") {
    return new Root$1(defaults);
  } else if (defaults.type === "decl") {
    return new Declaration$1(defaults);
  } else if (defaults.type === "rule") {
    return new Rule$1(defaults);
  } else if (defaults.type === "comment") {
    return new Comment$1(defaults);
  } else if (defaults.type === "atrule") {
    return new AtRule$1(defaults);
  } else {
    throw new Error("Unknown node type: " + json.type);
  }
}
var fromJSON_1 = fromJSON$1;
fromJSON$1.default = fromJSON$1;
let CssSyntaxError22 = cssSyntaxError;
let Declaration22 = declaration;
let LazyResult22 = lazyResult;
let Container22 = container;
let Processor22 = processor;
let stringify = stringify_1;
let fromJSON = fromJSON_1;
let Document222 = document$1;
let Warning22 = warning;
let Comment22 = comment;
let AtRule22 = atRule;
let Result22 = result;
let Input22 = input;
let parse = parse_1;
let list = list_1;
let Rule22 = rule;
let Root22 = root;
let Node22 = node;
function postcss(...plugins) {
  if (plugins.length === 1 && Array.isArray(plugins[0])) {
    plugins = plugins[0];
  }
  return new Processor22(plugins);
}
postcss.plugin = function plugin2(name, initializer) {
  let warningPrinted = false;
  function creator(...args) {
    if (console && console.warn && !warningPrinted) {
      warningPrinted = true;
      console.warn(
        name + ": postcss.plugin was deprecated. Migration guide:\nhttps://evilmartians.com/chronicles/postcss-8-plugin-migration"
      );
      if (process.env.LANG && process.env.LANG.startsWith("cn")) {
        console.warn(
          name + ": \u91CC\u9762 postcss.plugin \u88AB\u5F03\u7528. \u8FC1\u79FB\u6307\u5357:\nhttps://www.w3ctech.com/topic/2226"
        );
      }
    }
    let transformer = initializer(...args);
    transformer.postcssPlugin = name;
    transformer.postcssVersion = new Processor22().version;
    return transformer;
  }
  let cache;
  Object.defineProperty(creator, "postcss", {
    get() {
      if (!cache) cache = creator();
      return cache;
    }
  });
  creator.process = function(css, processOpts, pluginOpts) {
    return postcss([creator(pluginOpts)]).process(css, processOpts);
  };
  return creator;
};
postcss.stringify = stringify;
postcss.parse = parse;
postcss.fromJSON = fromJSON;
postcss.list = list;
postcss.comment = (defaults) => new Comment22(defaults);
postcss.atRule = (defaults) => new AtRule22(defaults);
postcss.decl = (defaults) => new Declaration22(defaults);
postcss.rule = (defaults) => new Rule22(defaults);
postcss.root = (defaults) => new Root22(defaults);
postcss.document = (defaults) => new Document222(defaults);
postcss.CssSyntaxError = CssSyntaxError22;
postcss.Declaration = Declaration22;
postcss.Container = Container22;
postcss.Processor = Processor22;
postcss.Document = Document222;
postcss.Comment = Comment22;
postcss.Warning = Warning22;
postcss.AtRule = AtRule22;
postcss.Result = Result22;
postcss.Input = Input22;
postcss.Rule = Rule22;
postcss.Root = Root22;
postcss.Node = Node22;
LazyResult22.registerPostcss(postcss);
var postcss_1 = postcss;
postcss.default = postcss;
const postcss$1 = /* @__PURE__ */ getDefaultExportFromCjs(postcss_1);
postcss$1.stringify;
postcss$1.fromJSON;
postcss$1.plugin;
postcss$1.parse;
postcss$1.list;
postcss$1.document;
postcss$1.comment;
postcss$1.atRule;
postcss$1.rule;
postcss$1.decl;
postcss$1.root;
postcss$1.CssSyntaxError;
postcss$1.Declaration;
postcss$1.Container;
postcss$1.Processor;
postcss$1.Document;
postcss$1.Comment;
postcss$1.Warning;
postcss$1.AtRule;
postcss$1.Result;
postcss$1.Input;
postcss$1.Rule;
postcss$1.Root;
postcss$1.Node;
var NodeType$1 = /* @__PURE__ */ ((NodeType2) => {
  NodeType2[NodeType2["Document"] = 0] = "Document";
  NodeType2[NodeType2["DocumentType"] = 1] = "DocumentType";
  NodeType2[NodeType2["Element"] = 2] = "Element";
  NodeType2[NodeType2["Text"] = 3] = "Text";
  NodeType2[NodeType2["CDATA"] = 4] = "CDATA";
  NodeType2[NodeType2["Comment"] = 5] = "Comment";
  return NodeType2;
})(NodeType$1 || {});
function parseCSSText(cssText) {
  const res = {};
  const listDelimiter = /;(?![^(]*\))/g;
  const propertyDelimiter = /:(.+)/;
  const comment2 = /\/\*.*?\*\//g;
  cssText.replace(comment2, "").split(listDelimiter).forEach(function(item) {
    if (item) {
      const tmp = item.split(propertyDelimiter);
      tmp.length > 1 && (res[camelize(tmp[0].trim())] = tmp[1].trim());
    }
  });
  return res;
}
function toCSSText(style) {
  const properties = [];
  for (const name in style) {
    const value = style[name];
    if (typeof value !== "string") continue;
    const normalizedName = hyphenate(name);
    properties.push(`${normalizedName}: ${value};`);
  }
  return properties.join(" ");
}
const camelizeRE = /-([a-z])/g;
const CUSTOM_PROPERTY_REGEX = /^--[a-zA-Z0-9-]+$/;
const camelize = (str) => {
  if (CUSTOM_PROPERTY_REGEX.test(str)) return str;
  return str.replace(camelizeRE, (_, c2) => c2 ? c2.toUpperCase() : "");
};
const hyphenateRE = /\B([A-Z])/g;
const hyphenate = (str) => {
  return str.replace(hyphenateRE, "-$1").toLowerCase();
};
class BaseRRNode {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
  constructor(..._args) {
    __publicField22(this, "parentElement", null);
    __publicField22(this, "parentNode", null);
    __publicField22(this, "ownerDocument");
    __publicField22(this, "firstChild", null);
    __publicField22(this, "lastChild", null);
    __publicField22(this, "previousSibling", null);
    __publicField22(this, "nextSibling", null);
    __publicField22(this, "ELEMENT_NODE", 1);
    __publicField22(this, "TEXT_NODE", 3);
    __publicField22(this, "nodeType");
    __publicField22(this, "nodeName");
    __publicField22(this, "RRNodeType");
  }
  get childNodes() {
    const childNodes2 = [];
    let childIterator = this.firstChild;
    while (childIterator) {
      childNodes2.push(childIterator);
      childIterator = childIterator.nextSibling;
    }
    return childNodes2;
  }
  contains(node2) {
    if (!(node2 instanceof BaseRRNode)) return false;
    else if (node2.ownerDocument !== this.ownerDocument) return false;
    else if (node2 === this) return true;
    while (node2.parentNode) {
      if (node2.parentNode === this) return true;
      node2 = node2.parentNode;
    }
    return false;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  appendChild(_newChild) {
    throw new Error(
      `RRDomException: Failed to execute 'appendChild' on 'RRNode': This RRNode type does not support this method.`
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  insertBefore(_newChild, _refChild) {
    throw new Error(
      `RRDomException: Failed to execute 'insertBefore' on 'RRNode': This RRNode type does not support this method.`
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  removeChild(_node) {
    throw new Error(
      `RRDomException: Failed to execute 'removeChild' on 'RRNode': This RRNode type does not support this method.`
    );
  }
  toString() {
    return "RRNode";
  }
}
class BaseRRDocument extends BaseRRNode {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(...args) {
    super(args);
    __publicField22(this, "nodeType", 9);
    __publicField22(this, "nodeName", "#document");
    __publicField22(this, "compatMode", "CSS1Compat");
    __publicField22(this, "RRNodeType", NodeType$1.Document);
    __publicField22(this, "textContent", null);
    this.ownerDocument = this;
  }
  get documentElement() {
    return this.childNodes.find(
      (node2) => node2.RRNodeType === NodeType$1.Element && node2.tagName === "HTML"
    ) || null;
  }
  get body() {
    var _a2;
    return ((_a2 = this.documentElement) == null ? void 0 : _a2.childNodes.find(
      (node2) => node2.RRNodeType === NodeType$1.Element && node2.tagName === "BODY"
    )) || null;
  }
  get head() {
    var _a2;
    return ((_a2 = this.documentElement) == null ? void 0 : _a2.childNodes.find(
      (node2) => node2.RRNodeType === NodeType$1.Element && node2.tagName === "HEAD"
    )) || null;
  }
  get implementation() {
    return this;
  }
  get firstElementChild() {
    return this.documentElement;
  }
  appendChild(newChild) {
    const nodeType = newChild.RRNodeType;
    if (nodeType === NodeType$1.Element || nodeType === NodeType$1.DocumentType) {
      if (this.childNodes.some((s2) => s2.RRNodeType === nodeType)) {
        throw new Error(
          `RRDomException: Failed to execute 'appendChild' on 'RRNode': Only one ${nodeType === NodeType$1.Element ? "RRElement" : "RRDoctype"} on RRDocument allowed.`
        );
      }
    }
    const child = appendChild(this, newChild);
    child.parentElement = null;
    return child;
  }
  insertBefore(newChild, refChild) {
    const nodeType = newChild.RRNodeType;
    if (nodeType === NodeType$1.Element || nodeType === NodeType$1.DocumentType) {
      if (this.childNodes.some((s2) => s2.RRNodeType === nodeType)) {
        throw new Error(
          `RRDomException: Failed to execute 'insertBefore' on 'RRNode': Only one ${nodeType === NodeType$1.Element ? "RRElement" : "RRDoctype"} on RRDocument allowed.`
        );
      }
    }
    const child = insertBefore(this, newChild, refChild);
    child.parentElement = null;
    return child;
  }
  removeChild(node2) {
    return removeChild(this, node2);
  }
  open() {
    this.firstChild = null;
    this.lastChild = null;
  }
  close() {
  }
  /**
   * Adhoc implementation for setting xhtml namespace in rebuilt.ts (rrweb-snapshot).
   * There are two lines used this function:
   * 1. doc.write('\<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" ""\>')
   * 2. doc.write('\<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.0 Transitional//EN" ""\>')
   */
  write(content) {
    let publicId;
    if (content === '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "">')
      publicId = "-//W3C//DTD XHTML 1.0 Transitional//EN";
    else if (content === '<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.0 Transitional//EN" "">')
      publicId = "-//W3C//DTD HTML 4.0 Transitional//EN";
    if (publicId) {
      const doctype = this.createDocumentType("html", publicId, "");
      this.open();
      this.appendChild(doctype);
    }
  }
  createDocument(_namespace, _qualifiedName, _doctype) {
    return new BaseRRDocument();
  }
  createDocumentType(qualifiedName, publicId, systemId) {
    const doctype = new BaseRRDocumentType(qualifiedName, publicId, systemId);
    doctype.ownerDocument = this;
    return doctype;
  }
  createElement(tagName) {
    const element2 = new BaseRRElement(tagName);
    element2.ownerDocument = this;
    return element2;
  }
  createElementNS(_namespaceURI, qualifiedName) {
    return this.createElement(qualifiedName);
  }
  createTextNode(data) {
    const text2 = new BaseRRText(data);
    text2.ownerDocument = this;
    return text2;
  }
  createComment(data) {
    const comment2 = new BaseRRComment(data);
    comment2.ownerDocument = this;
    return comment2;
  }
  createCDATASection(data) {
    const CDATASection = new BaseRRCDATASection(data);
    CDATASection.ownerDocument = this;
    return CDATASection;
  }
  toString() {
    return "RRDocument";
  }
}
class BaseRRDocumentType extends BaseRRNode {
  constructor(qualifiedName, publicId, systemId) {
    super();
    __publicField22(this, "nodeType", 10);
    __publicField22(this, "RRNodeType", NodeType$1.DocumentType);
    __publicField22(this, "name");
    __publicField22(this, "publicId");
    __publicField22(this, "systemId");
    __publicField22(this, "textContent", null);
    this.name = qualifiedName;
    this.publicId = publicId;
    this.systemId = systemId;
    this.nodeName = qualifiedName;
  }
  toString() {
    return "RRDocumentType";
  }
}
class BaseRRElement extends BaseRRNode {
  constructor(tagName) {
    super();
    __publicField22(this, "nodeType", 1);
    __publicField22(this, "RRNodeType", NodeType$1.Element);
    __publicField22(this, "tagName");
    __publicField22(this, "attributes", {});
    __publicField22(this, "shadowRoot", null);
    __publicField22(this, "scrollLeft");
    __publicField22(this, "scrollTop");
    this.tagName = tagName.toUpperCase();
    this.nodeName = tagName.toUpperCase();
  }
  get textContent() {
    let result2 = "";
    this.childNodes.forEach((node2) => result2 += node2.textContent);
    return result2;
  }
  set textContent(textContent2) {
    this.firstChild = null;
    this.lastChild = null;
    this.appendChild(this.ownerDocument.createTextNode(textContent2));
  }
  get classList() {
    return new ClassList(
      this.attributes.class,
      (newClassName) => {
        this.attributes.class = newClassName;
      }
    );
  }
  get id() {
    return this.attributes.id || "";
  }
  get className() {
    return this.attributes.class || "";
  }
  get style() {
    const style = this.attributes.style ? parseCSSText(this.attributes.style) : {};
    const hyphenateRE2 = /\B([A-Z])/g;
    style.setProperty = (name, value, priority) => {
      if (hyphenateRE2.test(name)) return;
      const normalizedName = camelize(name);
      if (!value) delete style[normalizedName];
      else style[normalizedName] = value;
      if (priority === "important") style[normalizedName] += " !important";
      this.attributes.style = toCSSText(style);
    };
    style.removeProperty = (name) => {
      if (hyphenateRE2.test(name)) return "";
      const normalizedName = camelize(name);
      const value = style[normalizedName] || "";
      delete style[normalizedName];
      this.attributes.style = toCSSText(style);
      return value;
    };
    return style;
  }
  getAttribute(name) {
    if (this.attributes[name] === void 0) return null;
    return this.attributes[name];
  }
  setAttribute(name, attribute) {
    this.attributes[name] = attribute;
  }
  setAttributeNS(_namespace, qualifiedName, value) {
    this.setAttribute(qualifiedName, value);
  }
  removeAttribute(name) {
    delete this.attributes[name];
  }
  appendChild(newChild) {
    return appendChild(this, newChild);
  }
  insertBefore(newChild, refChild) {
    return insertBefore(this, newChild, refChild);
  }
  removeChild(node2) {
    return removeChild(this, node2);
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  attachShadow(_init) {
    const shadowRoot2 = this.ownerDocument.createElement("SHADOWROOT");
    this.shadowRoot = shadowRoot2;
    return shadowRoot2;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  dispatchEvent(_event) {
    return true;
  }
  toString() {
    let attributeString = "";
    for (const attribute in this.attributes) {
      attributeString += `${attribute}="${this.attributes[attribute]}" `;
    }
    return `${this.tagName} ${attributeString}`;
  }
}
class BaseRRMediaElement extends BaseRRElement {
  constructor() {
    super(...arguments);
    __publicField22(this, "currentTime");
    __publicField22(this, "volume");
    __publicField22(this, "paused");
    __publicField22(this, "muted");
    __publicField22(this, "playbackRate");
    __publicField22(this, "loop");
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  attachShadow(_init) {
    throw new Error(
      `RRDomException: Failed to execute 'attachShadow' on 'RRElement': This RRElement does not support attachShadow`
    );
  }
  play() {
    this.paused = false;
  }
  pause() {
    this.paused = true;
  }
}
class BaseRRDialogElement extends BaseRRElement {
  constructor() {
    super(...arguments);
    __publicField22(this, "tagName", "DIALOG");
    __publicField22(this, "nodeName", "DIALOG");
  }
  get isModal() {
    return this.getAttribute("rr_open_mode") === "modal";
  }
  get open() {
    return this.getAttribute("open") !== null;
  }
  close() {
    this.removeAttribute("open");
    this.removeAttribute("rr_open_mode");
  }
  show() {
    this.setAttribute("open", "");
    this.setAttribute("rr_open_mode", "non-modal");
  }
  showModal() {
    this.setAttribute("open", "");
    this.setAttribute("rr_open_mode", "modal");
  }
}
class BaseRRText extends BaseRRNode {
  constructor(data) {
    super();
    __publicField22(this, "nodeType", 3);
    __publicField22(this, "nodeName", "#text");
    __publicField22(this, "RRNodeType", NodeType$1.Text);
    __publicField22(this, "data");
    this.data = data;
  }
  get textContent() {
    return this.data;
  }
  set textContent(textContent2) {
    this.data = textContent2;
  }
  toString() {
    return `RRText text=${JSON.stringify(this.data)}`;
  }
}
class BaseRRComment extends BaseRRNode {
  constructor(data) {
    super();
    __publicField22(this, "nodeType", 8);
    __publicField22(this, "nodeName", "#comment");
    __publicField22(this, "RRNodeType", NodeType$1.Comment);
    __publicField22(this, "data");
    this.data = data;
  }
  get textContent() {
    return this.data;
  }
  set textContent(textContent2) {
    this.data = textContent2;
  }
  toString() {
    return `RRComment text=${JSON.stringify(this.data)}`;
  }
}
class BaseRRCDATASection extends BaseRRNode {
  constructor(data) {
    super();
    __publicField22(this, "nodeName", "#cdata-section");
    __publicField22(this, "nodeType", 4);
    __publicField22(this, "RRNodeType", NodeType$1.CDATA);
    __publicField22(this, "data");
    this.data = data;
  }
  get textContent() {
    return this.data;
  }
  set textContent(textContent2) {
    this.data = textContent2;
  }
  toString() {
    return `RRCDATASection data=${JSON.stringify(this.data)}`;
  }
}
class ClassList {
  constructor(classText, onChange) {
    __publicField22(this, "onChange");
    __publicField22(this, "classes", []);
    __publicField22(this, "add", (...classNames) => {
      for (const item of classNames) {
        const className = String(item);
        if (this.classes.indexOf(className) >= 0) continue;
        this.classes.push(className);
      }
      this.onChange && this.onChange(this.classes.join(" "));
    });
    __publicField22(this, "remove", (...classNames) => {
      this.classes = this.classes.filter(
        (item) => classNames.indexOf(item) === -1
      );
      this.onChange && this.onChange(this.classes.join(" "));
    });
    if (classText) {
      const classes = classText.trim().split(/\s+/);
      this.classes.push(...classes);
    }
    this.onChange = onChange;
  }
}
function appendChild(parent, newChild) {
  if (newChild.parentNode) newChild.parentNode.removeChild(newChild);
  if (parent.lastChild) {
    parent.lastChild.nextSibling = newChild;
    newChild.previousSibling = parent.lastChild;
  } else {
    parent.firstChild = newChild;
    newChild.previousSibling = null;
  }
  parent.lastChild = newChild;
  newChild.nextSibling = null;
  newChild.parentNode = parent;
  newChild.parentElement = parent;
  newChild.ownerDocument = parent.ownerDocument;
  return newChild;
}
function insertBefore(parent, newChild, refChild) {
  if (!refChild) return appendChild(parent, newChild);
  if (refChild.parentNode !== parent)
    throw new Error(
      "Failed to execute 'insertBefore' on 'RRNode': The RRNode before which the new node is to be inserted is not a child of this RRNode."
    );
  if (newChild === refChild) return newChild;
  if (newChild.parentNode) newChild.parentNode.removeChild(newChild);
  newChild.previousSibling = refChild.previousSibling;
  refChild.previousSibling = newChild;
  newChild.nextSibling = refChild;
  if (newChild.previousSibling) newChild.previousSibling.nextSibling = newChild;
  else parent.firstChild = newChild;
  newChild.parentElement = parent;
  newChild.parentNode = parent;
  newChild.ownerDocument = parent.ownerDocument;
  return newChild;
}
function removeChild(parent, child) {
  if (child.parentNode !== parent)
    throw new Error(
      "Failed to execute 'removeChild' on 'RRNode': The RRNode to be removed is not a child of this RRNode."
    );
  if (child.previousSibling)
    child.previousSibling.nextSibling = child.nextSibling;
  else parent.firstChild = child.nextSibling;
  if (child.nextSibling)
    child.nextSibling.previousSibling = child.previousSibling;
  else parent.lastChild = child.previousSibling;
  child.previousSibling = null;
  child.nextSibling = null;
  child.parentElement = null;
  child.parentNode = null;
  return child;
}
var NodeType$2 = /* @__PURE__ */ ((NodeType2) => {
  NodeType2[NodeType2["PLACEHOLDER"] = 0] = "PLACEHOLDER";
  NodeType2[NodeType2["ELEMENT_NODE"] = 1] = "ELEMENT_NODE";
  NodeType2[NodeType2["ATTRIBUTE_NODE"] = 2] = "ATTRIBUTE_NODE";
  NodeType2[NodeType2["TEXT_NODE"] = 3] = "TEXT_NODE";
  NodeType2[NodeType2["CDATA_SECTION_NODE"] = 4] = "CDATA_SECTION_NODE";
  NodeType2[NodeType2["ENTITY_REFERENCE_NODE"] = 5] = "ENTITY_REFERENCE_NODE";
  NodeType2[NodeType2["ENTITY_NODE"] = 6] = "ENTITY_NODE";
  NodeType2[NodeType2["PROCESSING_INSTRUCTION_NODE"] = 7] = "PROCESSING_INSTRUCTION_NODE";
  NodeType2[NodeType2["COMMENT_NODE"] = 8] = "COMMENT_NODE";
  NodeType2[NodeType2["DOCUMENT_NODE"] = 9] = "DOCUMENT_NODE";
  NodeType2[NodeType2["DOCUMENT_TYPE_NODE"] = 10] = "DOCUMENT_TYPE_NODE";
  NodeType2[NodeType2["DOCUMENT_FRAGMENT_NODE"] = 11] = "DOCUMENT_FRAGMENT_NODE";
  return NodeType2;
})(NodeType$2 || {});
const NAMESPACES = {
  svg: "http://www.w3.org/2000/svg",
  "xlink:href": "http://www.w3.org/1999/xlink",
  xmlns: "http://www.w3.org/2000/xmlns/"
};
const SVGTagMap = {
  altglyph: "altGlyph",
  altglyphdef: "altGlyphDef",
  altglyphitem: "altGlyphItem",
  animatecolor: "animateColor",
  animatemotion: "animateMotion",
  animatetransform: "animateTransform",
  clippath: "clipPath",
  feblend: "feBlend",
  fecolormatrix: "feColorMatrix",
  fecomponenttransfer: "feComponentTransfer",
  fecomposite: "feComposite",
  feconvolvematrix: "feConvolveMatrix",
  fediffuselighting: "feDiffuseLighting",
  fedisplacementmap: "feDisplacementMap",
  fedistantlight: "feDistantLight",
  fedropshadow: "feDropShadow",
  feflood: "feFlood",
  fefunca: "feFuncA",
  fefuncb: "feFuncB",
  fefuncg: "feFuncG",
  fefuncr: "feFuncR",
  fegaussianblur: "feGaussianBlur",
  feimage: "feImage",
  femerge: "feMerge",
  femergenode: "feMergeNode",
  femorphology: "feMorphology",
  feoffset: "feOffset",
  fepointlight: "fePointLight",
  fespecularlighting: "feSpecularLighting",
  fespotlight: "feSpotLight",
  fetile: "feTile",
  feturbulence: "feTurbulence",
  foreignobject: "foreignObject",
  glyphref: "glyphRef",
  lineargradient: "linearGradient",
  radialgradient: "radialGradient"
};
let createdNodeSet = null;
function diff(oldTree, newTree, replayer, rrnodeMirror = newTree.mirror || newTree.ownerDocument.mirror) {
  oldTree = diffBeforeUpdatingChildren(
    oldTree,
    newTree,
    replayer,
    rrnodeMirror
  );
  diffChildren(oldTree, newTree, replayer, rrnodeMirror);
  diffAfterUpdatingChildren(oldTree, newTree, replayer);
}
function diffBeforeUpdatingChildren(oldTree, newTree, replayer, rrnodeMirror) {
  var _a2;
  if (replayer.afterAppend && !createdNodeSet) {
    createdNodeSet = /* @__PURE__ */ new WeakSet();
    setTimeout(() => {
      createdNodeSet = null;
    }, 0);
  }
  if (!sameNodeType(oldTree, newTree)) {
    const calibratedOldTree = createOrGetNode(
      newTree,
      replayer.mirror,
      rrnodeMirror
    );
    (_a2 = oldTree.parentNode) == null ? void 0 : _a2.replaceChild(calibratedOldTree, oldTree);
    oldTree = calibratedOldTree;
  }
  switch (newTree.RRNodeType) {
    case NodeType$1.Document: {
      if (!nodeMatching(oldTree, newTree, replayer.mirror, rrnodeMirror)) {
        const newMeta = rrnodeMirror.getMeta(newTree);
        if (newMeta) {
          replayer.mirror.removeNodeFromMap(oldTree);
          oldTree.close();
          oldTree.open();
          replayer.mirror.add(oldTree, newMeta);
          createdNodeSet == null ? void 0 : createdNodeSet.add(oldTree);
        }
      }
      break;
    }
    case NodeType$1.Element: {
      const oldElement = oldTree;
      const newRRElement = newTree;
      switch (newRRElement.tagName) {
        case "IFRAME": {
          const oldContentDocument = oldTree.contentDocument;
          if (!oldContentDocument) break;
          diff(
            oldContentDocument,
            newTree.contentDocument,
            replayer,
            rrnodeMirror
          );
          break;
        }
      }
      if (newRRElement.shadowRoot) {
        if (!oldElement.shadowRoot) oldElement.attachShadow({ mode: "open" });
        diffChildren(
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          oldElement.shadowRoot,
          newRRElement.shadowRoot,
          replayer,
          rrnodeMirror
        );
      }
      diffProps(oldElement, newRRElement, rrnodeMirror);
      break;
    }
  }
  return oldTree;
}
function diffAfterUpdatingChildren(oldTree, newTree, replayer) {
  var _a2;
  switch (newTree.RRNodeType) {
    case NodeType$1.Document: {
      const scrollData = newTree.scrollData;
      scrollData && replayer.applyScroll(scrollData, true);
      break;
    }
    case NodeType$1.Element: {
      const oldElement = oldTree;
      const newRRElement = newTree;
      newRRElement.scrollData && replayer.applyScroll(newRRElement.scrollData, true);
      newRRElement.inputData && replayer.applyInput(newRRElement.inputData);
      switch (newRRElement.tagName) {
        case "AUDIO":
        case "VIDEO": {
          const oldMediaElement = oldTree;
          const newMediaRRElement = newRRElement;
          if (newMediaRRElement.paused !== void 0)
            newMediaRRElement.paused ? void oldMediaElement.pause() : void oldMediaElement.play();
          if (newMediaRRElement.muted !== void 0)
            oldMediaElement.muted = newMediaRRElement.muted;
          if (newMediaRRElement.volume !== void 0)
            oldMediaElement.volume = newMediaRRElement.volume;
          if (newMediaRRElement.currentTime !== void 0)
            oldMediaElement.currentTime = newMediaRRElement.currentTime;
          if (newMediaRRElement.playbackRate !== void 0)
            oldMediaElement.playbackRate = newMediaRRElement.playbackRate;
          if (newMediaRRElement.loop !== void 0)
            oldMediaElement.loop = newMediaRRElement.loop;
          break;
        }
        case "CANVAS": {
          const rrCanvasElement = newTree;
          if (rrCanvasElement.rr_dataURL !== null) {
            const image = document.createElement("img");
            image.onload = () => {
              const ctx = oldElement.getContext("2d");
              if (ctx) {
                ctx.drawImage(image, 0, 0, image.width, image.height);
              }
            };
            image.src = rrCanvasElement.rr_dataURL;
          }
          rrCanvasElement.canvasMutations.forEach(
            (canvasMutation2) => replayer.applyCanvas(
              canvasMutation2.event,
              canvasMutation2.mutation,
              oldTree
            )
          );
          break;
        }
        case "STYLE": {
          const styleSheet = oldElement.sheet;
          styleSheet && newTree.rules.forEach(
            (data) => replayer.applyStyleSheetMutation(data, styleSheet)
          );
          break;
        }
        case "DIALOG": {
          const dialog = oldElement;
          const rrDialog = newRRElement;
          const wasOpen = dialog.open;
          const wasModal = dialog.matches("dialog:modal");
          const shouldBeOpen = rrDialog.open;
          const shouldBeModal = rrDialog.isModal;
          const modalChanged = wasModal !== shouldBeModal;
          const openChanged = wasOpen !== shouldBeOpen;
          if (modalChanged || wasOpen && openChanged) dialog.close();
          if (shouldBeOpen && (openChanged || modalChanged)) {
            try {
              if (shouldBeModal) dialog.showModal();
              else dialog.show();
            } catch (e2) {
              console.warn(e2);
            }
          }
          break;
        }
      }
      break;
    }
    case NodeType$1.Text:
    case NodeType$1.Comment:
    case NodeType$1.CDATA: {
      if (oldTree.textContent !== newTree.data)
        oldTree.textContent = newTree.data;
      break;
    }
  }
  if (createdNodeSet == null ? void 0 : createdNodeSet.has(oldTree)) {
    createdNodeSet.delete(oldTree);
    (_a2 = replayer.afterAppend) == null ? void 0 : _a2.call(replayer, oldTree, replayer.mirror.getId(oldTree));
  }
}
function diffProps(oldTree, newTree, rrnodeMirror) {
  const oldAttributes = oldTree.attributes;
  const newAttributes = newTree.attributes;
  for (const name in newAttributes) {
    const newValue = newAttributes[name];
    const sn = rrnodeMirror.getMeta(newTree);
    if ((sn == null ? void 0 : sn.isSVG) && NAMESPACES[name])
      oldTree.setAttributeNS(NAMESPACES[name], name, newValue);
    else if (newTree.tagName === "CANVAS" && name === "rr_dataURL") {
      const image = document.createElement("img");
      image.src = newValue;
      image.onload = () => {
        const ctx = oldTree.getContext("2d");
        if (ctx) {
          ctx.drawImage(image, 0, 0, image.width, image.height);
        }
      };
    } else if (newTree.tagName === "IFRAME" && name === "srcdoc") continue;
    else {
      try {
        oldTree.setAttribute(name, newValue);
      } catch (err) {
        console.warn(err);
      }
    }
  }
  for (const { name } of Array.from(oldAttributes))
    if (!(name in newAttributes)) oldTree.removeAttribute(name);
  newTree.scrollLeft && (oldTree.scrollLeft = newTree.scrollLeft);
  newTree.scrollTop && (oldTree.scrollTop = newTree.scrollTop);
}
function diffChildren(oldTree, newTree, replayer, rrnodeMirror) {
  const oldChildren = Array.from(oldTree.childNodes);
  const newChildren = newTree.childNodes;
  if (oldChildren.length === 0 && newChildren.length === 0) return;
  let oldStartIndex = 0, oldEndIndex = oldChildren.length - 1, newStartIndex = 0, newEndIndex = newChildren.length - 1;
  let oldStartNode = oldChildren[oldStartIndex], oldEndNode = oldChildren[oldEndIndex], newStartNode = newChildren[newStartIndex], newEndNode = newChildren[newEndIndex];
  let oldIdToIndex = void 0, indexInOld = void 0;
  while (oldStartIndex <= oldEndIndex && newStartIndex <= newEndIndex) {
    if (oldStartNode === void 0) {
      oldStartNode = oldChildren[++oldStartIndex];
    } else if (oldEndNode === void 0) {
      oldEndNode = oldChildren[--oldEndIndex];
    } else if (
      // same first node?
      nodeMatching(oldStartNode, newStartNode, replayer.mirror, rrnodeMirror)
    ) {
      oldStartNode = oldChildren[++oldStartIndex];
      newStartNode = newChildren[++newStartIndex];
    } else if (
      // same last node?
      nodeMatching(oldEndNode, newEndNode, replayer.mirror, rrnodeMirror)
    ) {
      oldEndNode = oldChildren[--oldEndIndex];
      newEndNode = newChildren[--newEndIndex];
    } else if (
      // is the first old node the same as the last new node?
      nodeMatching(oldStartNode, newEndNode, replayer.mirror, rrnodeMirror)
    ) {
      try {
        oldTree.insertBefore(oldStartNode, oldEndNode.nextSibling);
      } catch (e2) {
        console.warn(e2);
      }
      oldStartNode = oldChildren[++oldStartIndex];
      newEndNode = newChildren[--newEndIndex];
    } else if (
      // is the last old node the same as the first new node?
      nodeMatching(oldEndNode, newStartNode, replayer.mirror, rrnodeMirror)
    ) {
      try {
        oldTree.insertBefore(oldEndNode, oldStartNode);
      } catch (e2) {
        console.warn(e2);
      }
      oldEndNode = oldChildren[--oldEndIndex];
      newStartNode = newChildren[++newStartIndex];
    } else {
      if (!oldIdToIndex) {
        oldIdToIndex = {};
        for (let i2 = oldStartIndex; i2 <= oldEndIndex; i2++) {
          const oldChild2 = oldChildren[i2];
          if (oldChild2 && replayer.mirror.hasNode(oldChild2))
            oldIdToIndex[replayer.mirror.getId(oldChild2)] = i2;
        }
      }
      indexInOld = oldIdToIndex[rrnodeMirror.getId(newStartNode)];
      const nodeToMove = oldChildren[indexInOld];
      if (indexInOld !== void 0 && nodeToMove && nodeMatching(nodeToMove, newStartNode, replayer.mirror, rrnodeMirror)) {
        try {
          oldTree.insertBefore(nodeToMove, oldStartNode);
        } catch (e2) {
          console.warn(e2);
        }
        oldChildren[indexInOld] = void 0;
      } else {
        const newNode = createOrGetNode(
          newStartNode,
          replayer.mirror,
          rrnodeMirror
        );
        if (oldTree.nodeName === "#document" && oldStartNode && /**
        * Special case 1: one document isn't allowed to have two doctype nodes at the same time, so we need to remove the old one first before inserting the new one.
        * How this case happens: A parent document in the old tree already has a doctype node with an id e.g. #1. A new full snapshot rebuilds the replayer with a new doctype node with another id #2. According to the algorithm, the new doctype node will be inserted before the old one, which is not allowed by the Document standard.
        */
        (newNode.nodeType === newNode.DOCUMENT_TYPE_NODE && oldStartNode.nodeType === oldStartNode.DOCUMENT_TYPE_NODE || /**
        * Special case 2: one document isn't allowed to have two HTMLElements at the same time, so we need to remove the old one first before inserting the new one.
        * How this case happens: A mounted iframe element has an automatically created HTML element. We should delete it before inserting a serialized one. Otherwise, an error 'Only one element on document allowed' will be thrown.
        */
        newNode.nodeType === newNode.ELEMENT_NODE && oldStartNode.nodeType === oldStartNode.ELEMENT_NODE)) {
          oldTree.removeChild(oldStartNode);
          replayer.mirror.removeNodeFromMap(oldStartNode);
          oldStartNode = oldChildren[++oldStartIndex];
        }
        try {
          oldTree.insertBefore(newNode, oldStartNode || null);
        } catch (e2) {
          console.warn(e2);
        }
      }
      newStartNode = newChildren[++newStartIndex];
    }
  }
  if (oldStartIndex > oldEndIndex) {
    const referenceRRNode = newChildren[newEndIndex + 1];
    let referenceNode = null;
    if (referenceRRNode)
      referenceNode = replayer.mirror.getNode(
        rrnodeMirror.getId(referenceRRNode)
      );
    for (; newStartIndex <= newEndIndex; ++newStartIndex) {
      const newNode = createOrGetNode(
        newChildren[newStartIndex],
        replayer.mirror,
        rrnodeMirror
      );
      try {
        oldTree.insertBefore(newNode, referenceNode);
      } catch (e2) {
        console.warn(e2);
      }
    }
  } else if (newStartIndex > newEndIndex) {
    for (; oldStartIndex <= oldEndIndex; oldStartIndex++) {
      const node2 = oldChildren[oldStartIndex];
      if (!node2 || node2.parentNode !== oldTree) continue;
      try {
        oldTree.removeChild(node2);
        replayer.mirror.removeNodeFromMap(node2);
      } catch (e2) {
        console.warn(e2);
      }
    }
  }
  let oldChild = oldTree.firstChild;
  let newChild = newTree.firstChild;
  while (oldChild !== null && newChild !== null) {
    diff(oldChild, newChild, replayer, rrnodeMirror);
    oldChild = oldChild.nextSibling;
    newChild = newChild.nextSibling;
  }
}
function createOrGetNode(rrNode, domMirror, rrnodeMirror) {
  const nodeId = rrnodeMirror.getId(rrNode);
  const sn = rrnodeMirror.getMeta(rrNode);
  let node2 = null;
  if (nodeId > -1) node2 = domMirror.getNode(nodeId);
  if (node2 !== null && sameNodeType(node2, rrNode)) return node2;
  switch (rrNode.RRNodeType) {
    case NodeType$1.Document:
      node2 = new Document();
      break;
    case NodeType$1.DocumentType:
      node2 = document.implementation.createDocumentType(
        rrNode.name,
        rrNode.publicId,
        rrNode.systemId
      );
      break;
    case NodeType$1.Element: {
      let tagName = rrNode.tagName.toLowerCase();
      tagName = SVGTagMap[tagName] || tagName;
      if (sn && "isSVG" in sn && (sn == null ? void 0 : sn.isSVG)) {
        node2 = document.createElementNS(NAMESPACES["svg"], tagName);
      } else node2 = document.createElement(rrNode.tagName);
      break;
    }
    case NodeType$1.Text:
      node2 = document.createTextNode(rrNode.data);
      break;
    case NodeType$1.Comment:
      node2 = document.createComment(rrNode.data);
      break;
    case NodeType$1.CDATA:
      node2 = document.createCDATASection(rrNode.data);
      break;
  }
  if (sn) domMirror.add(node2, __spreadValues({}, sn));
  try {
    createdNodeSet == null ? void 0 : createdNodeSet.add(node2);
  } catch (e2) {
  }
  return node2;
}
function sameNodeType(node1, node2) {
  if (node1.nodeType !== node2.nodeType) return false;
  return node1.nodeType !== node1.ELEMENT_NODE || node1.tagName.toUpperCase() === node2.tagName;
}
function nodeMatching(node1, node2, domMirror, rrdomMirror) {
  const node1Id = domMirror.getId(node1);
  const node2Id = rrdomMirror.getId(node2);
  if (node1Id === -1 || node1Id !== node2Id) return false;
  return sameNodeType(node1, node2);
}
class RRDocument extends BaseRRDocument {
  constructor(mirror2) {
    super();
    __publicField22(this, "UNSERIALIZED_STARTING_ID", -2);
    __publicField22(this, "_unserializedId", this.UNSERIALIZED_STARTING_ID);
    __publicField22(this, "mirror", createMirror());
    __publicField22(this, "scrollData", null);
    if (mirror2) {
      this.mirror = mirror2;
    }
  }
  /**
   * Every time the id is used, it will minus 1 automatically to avoid collisions.
   */
  get unserializedId() {
    return this._unserializedId--;
  }
  createDocument(_namespace, _qualifiedName, _doctype) {
    return new RRDocument();
  }
  createDocumentType(qualifiedName, publicId, systemId) {
    const documentTypeNode = new RRDocumentType(
      qualifiedName,
      publicId,
      systemId
    );
    documentTypeNode.ownerDocument = this;
    return documentTypeNode;
  }
  createElement(tagName) {
    const upperTagName = tagName.toUpperCase();
    let element2;
    switch (upperTagName) {
      case "AUDIO":
      case "VIDEO":
        element2 = new RRMediaElement(upperTagName);
        break;
      case "IFRAME":
        element2 = new RRIFrameElement(upperTagName, this.mirror);
        break;
      case "CANVAS":
        element2 = new RRCanvasElement(upperTagName);
        break;
      case "STYLE":
        element2 = new RRStyleElement(upperTagName);
        break;
      case "DIALOG":
        element2 = new RRDialogElement(upperTagName);
        break;
      default:
        element2 = new RRElement(upperTagName);
        break;
    }
    element2.ownerDocument = this;
    return element2;
  }
  createComment(data) {
    const commentNode = new RRComment(data);
    commentNode.ownerDocument = this;
    return commentNode;
  }
  createCDATASection(data) {
    const sectionNode = new RRCDATASection(data);
    sectionNode.ownerDocument = this;
    return sectionNode;
  }
  createTextNode(data) {
    const textNode = new RRText(data);
    textNode.ownerDocument = this;
    return textNode;
  }
  destroyTree() {
    this.firstChild = null;
    this.lastChild = null;
    this.mirror.reset();
  }
  open() {
    super.open();
    this._unserializedId = this.UNSERIALIZED_STARTING_ID;
  }
}
const RRDocumentType = BaseRRDocumentType;
class RRElement extends BaseRRElement {
  constructor() {
    super(...arguments);
    __publicField22(this, "inputData", null);
    __publicField22(this, "scrollData", null);
  }
}
class RRMediaElement extends BaseRRMediaElement {
}
class RRDialogElement extends BaseRRDialogElement {
}
class RRCanvasElement extends RRElement {
  constructor() {
    super(...arguments);
    __publicField22(this, "rr_dataURL", null);
    __publicField22(this, "canvasMutations", []);
  }
  /**
   * This is a dummy implementation to distinguish RRCanvasElement from real HTMLCanvasElement.
   */
  getContext() {
    return null;
  }
}
class RRStyleElement extends RRElement {
  constructor() {
    super(...arguments);
    __publicField22(this, "rules", []);
  }
}
class RRIFrameElement extends RRElement {
  constructor(upperTagName, mirror2) {
    super(upperTagName);
    __publicField22(this, "contentDocument", new RRDocument());
    this.contentDocument.mirror = mirror2;
  }
}
const RRText = BaseRRText;
const RRComment = BaseRRComment;
const RRCDATASection = BaseRRCDATASection;
function getValidTagName(element2) {
  if (element2 instanceof HTMLFormElement) {
    return "FORM";
  }
  return element2.tagName.toUpperCase();
}
function buildFromNode(node2, rrdom, domMirror, parentRRNode) {
  let rrNode;
  switch (node2.nodeType) {
    case NodeType$2.DOCUMENT_NODE:
      if (parentRRNode && parentRRNode.nodeName === "IFRAME")
        rrNode = parentRRNode.contentDocument;
      else {
        rrNode = rrdom;
        rrNode.compatMode = node2.compatMode;
      }
      break;
    case NodeType$2.DOCUMENT_TYPE_NODE: {
      const documentType = node2;
      rrNode = rrdom.createDocumentType(
        documentType.name,
        documentType.publicId,
        documentType.systemId
      );
      break;
    }
    case NodeType$2.ELEMENT_NODE: {
      const elementNode = node2;
      const tagName = getValidTagName(elementNode);
      rrNode = rrdom.createElement(tagName);
      const rrElement = rrNode;
      for (const { name, value } of Array.from(elementNode.attributes)) {
        rrElement.attributes[name] = value;
      }
      elementNode.scrollLeft && (rrElement.scrollLeft = elementNode.scrollLeft);
      elementNode.scrollTop && (rrElement.scrollTop = elementNode.scrollTop);
      break;
    }
    case NodeType$2.TEXT_NODE:
      rrNode = rrdom.createTextNode(node2.textContent || "");
      break;
    case NodeType$2.CDATA_SECTION_NODE:
      rrNode = rrdom.createCDATASection(node2.data);
      break;
    case NodeType$2.COMMENT_NODE:
      rrNode = rrdom.createComment(node2.textContent || "");
      break;
    case NodeType$2.DOCUMENT_FRAGMENT_NODE:
      rrNode = parentRRNode.attachShadow({ mode: "open" });
      break;
    default:
      return null;
  }
  let sn = domMirror.getMeta(node2);
  if (rrdom instanceof RRDocument) {
    if (!sn) {
      sn = getDefaultSN(rrNode, rrdom.unserializedId);
      domMirror.add(node2, sn);
    }
    rrdom.mirror.add(rrNode, __spreadValues({}, sn));
  }
  return rrNode;
}
function buildFromDom(dom, domMirror = createMirror$1(), rrdom = new RRDocument()) {
  function walk2(node2, parentRRNode) {
    const rrNode = buildFromNode(node2, rrdom, domMirror, parentRRNode);
    if (rrNode === null) return;
    if (
      // if the parentRRNode isn't a RRIFrameElement
      (parentRRNode == null ? void 0 : parentRRNode.nodeName) !== "IFRAME" && // if node isn't a shadow root
      node2.nodeType !== NodeType$2.DOCUMENT_FRAGMENT_NODE
    ) {
      parentRRNode == null ? void 0 : parentRRNode.appendChild(rrNode);
      rrNode.parentNode = parentRRNode;
      rrNode.parentElement = parentRRNode;
    }
    if (node2.nodeName === "IFRAME") {
      const iframeDoc = node2.contentDocument;
      iframeDoc && walk2(iframeDoc, rrNode);
    } else if (node2.nodeType === NodeType$2.DOCUMENT_NODE || node2.nodeType === NodeType$2.ELEMENT_NODE || node2.nodeType === NodeType$2.DOCUMENT_FRAGMENT_NODE) {
      if (node2.nodeType === NodeType$2.ELEMENT_NODE && node2.shadowRoot)
        walk2(node2.shadowRoot, rrNode);
      node2.childNodes.forEach((childNode) => walk2(childNode, rrNode));
    }
  }
  walk2(dom, null);
  return rrdom;
}
function createMirror() {
  return new Mirror22();
}
class Mirror22 {
  constructor() {
    __publicField22(this, "idNodeMap", /* @__PURE__ */ new Map());
    __publicField22(this, "nodeMetaMap", /* @__PURE__ */ new WeakMap());
  }
  getId(n2) {
    var _a2;
    if (!n2) return -1;
    const id = (_a2 = this.getMeta(n2)) == null ? void 0 : _a2.id;
    return id != null ? id : -1;
  }
  getNode(id) {
    return this.idNodeMap.get(id) || null;
  }
  getIds() {
    return Array.from(this.idNodeMap.keys());
  }
  getMeta(n2) {
    return this.nodeMetaMap.get(n2) || null;
  }
  // removes the node from idNodeMap
  // doesn't remove the node from nodeMetaMap
  removeNodeFromMap(n2) {
    const id = this.getId(n2);
    this.idNodeMap.delete(id);
    if (n2.childNodes) {
      n2.childNodes.forEach((childNode) => this.removeNodeFromMap(childNode));
    }
  }
  has(id) {
    return this.idNodeMap.has(id);
  }
  hasNode(node2) {
    return this.nodeMetaMap.has(node2);
  }
  add(n2, meta) {
    const id = meta.id;
    this.idNodeMap.set(id, n2);
    this.nodeMetaMap.set(n2, meta);
  }
  replace(id, n2) {
    const oldNode = this.getNode(id);
    if (oldNode) {
      const meta = this.nodeMetaMap.get(oldNode);
      if (meta) this.nodeMetaMap.set(n2, meta);
    }
    this.idNodeMap.set(id, n2);
  }
  reset() {
    this.idNodeMap = /* @__PURE__ */ new Map();
    this.nodeMetaMap = /* @__PURE__ */ new WeakMap();
  }
}
function getDefaultSN(node2, id) {
  switch (node2.RRNodeType) {
    case NodeType$1.Document:
      return {
        id,
        type: node2.RRNodeType,
        childNodes: []
      };
    case NodeType$1.DocumentType: {
      const doctype = node2;
      return {
        id,
        type: node2.RRNodeType,
        name: doctype.name,
        publicId: doctype.publicId,
        systemId: doctype.systemId
      };
    }
    case NodeType$1.Element:
      return {
        id,
        type: node2.RRNodeType,
        tagName: node2.tagName.toLowerCase(),
        // In rrweb data, all tagNames are lowercase.
        attributes: {},
        childNodes: []
      };
    case NodeType$1.Text:
      return {
        id,
        type: node2.RRNodeType,
        textContent: node2.textContent || ""
      };
    case NodeType$1.Comment:
      return {
        id,
        type: node2.RRNodeType,
        textContent: node2.textContent || ""
      };
    case NodeType$1.CDATA:
      return {
        id,
        type: node2.RRNodeType,
        textContent: ""
      };
  }
}
const testableAccessors = {
  Node: [
    "childNodes",
    "parentNode",
    "parentElement",
    "textContent",
    "ownerDocument"
  ],
  ShadowRoot: ["host", "styleSheets"],
  Element: ["shadowRoot", "querySelector", "querySelectorAll"],
  MutationObserver: []
};
const testableMethods = {
  Node: ["contains", "getRootNode"],
  ShadowRoot: ["getSelection"],
  Element: [],
  MutationObserver: ["constructor"]
};
const untaintedBasePrototype = {};
const isAngularZonePresent = () => {
  return !!globalThis.Zone;
};
function getUntaintedPrototype(key) {
  if (untaintedBasePrototype[key])
    return untaintedBasePrototype[key];
  const defaultObj = globalThis[key];
  const defaultPrototype = defaultObj.prototype;
  const accessorNames = key in testableAccessors ? testableAccessors[key] : void 0;
  const isUntaintedAccessors = Boolean(
    accessorNames && // @ts-expect-error 2345
    accessorNames.every(
      (accessor) => {
        var _a2, _b2;
        return Boolean(
          (_b2 = (_a2 = Object.getOwnPropertyDescriptor(defaultPrototype, accessor)) == null ? void 0 : _a2.get) == null ? void 0 : _b2.toString().includes("[native code]")
        );
      }
    )
  );
  const methodNames = key in testableMethods ? testableMethods[key] : void 0;
  const isUntaintedMethods = Boolean(
    methodNames && methodNames.every(
      // @ts-expect-error 2345
      (method) => {
        var _a2;
        return typeof defaultPrototype[method] === "function" && ((_a2 = defaultPrototype[method]) == null ? void 0 : _a2.toString().includes("[native code]"));
      }
    )
  );
  if (isUntaintedAccessors && isUntaintedMethods && !isAngularZonePresent()) {
    untaintedBasePrototype[key] = defaultObj.prototype;
    return defaultObj.prototype;
  }
  try {
    const iframeEl = document.createElement("iframe");
    document.body.appendChild(iframeEl);
    const win = iframeEl.contentWindow;
    if (!win) return defaultObj.prototype;
    const untaintedObject = win[key].prototype;
    document.body.removeChild(iframeEl);
    if (!untaintedObject) return defaultPrototype;
    return untaintedBasePrototype[key] = untaintedObject;
  } catch (e2) {
    return defaultPrototype;
  }
}
const untaintedAccessorCache = {};
function getUntaintedAccessor(key, instance2, accessor) {
  var _a2;
  const cacheKey = `${key}.${String(accessor)}`;
  if (untaintedAccessorCache[cacheKey])
    return untaintedAccessorCache[cacheKey].call(
      instance2
    );
  const untaintedPrototype = getUntaintedPrototype(key);
  const untaintedAccessor = (_a2 = Object.getOwnPropertyDescriptor(
    untaintedPrototype,
    accessor
  )) == null ? void 0 : _a2.get;
  if (!untaintedAccessor) return instance2[accessor];
  untaintedAccessorCache[cacheKey] = untaintedAccessor;
  return untaintedAccessor.call(instance2);
}
const untaintedMethodCache = {};
function getUntaintedMethod(key, instance2, method) {
  const cacheKey = `${key}.${String(method)}`;
  if (untaintedMethodCache[cacheKey])
    return untaintedMethodCache[cacheKey].bind(
      instance2
    );
  const untaintedPrototype = getUntaintedPrototype(key);
  const untaintedMethod = untaintedPrototype[method];
  if (typeof untaintedMethod !== "function") return instance2[method];
  untaintedMethodCache[cacheKey] = untaintedMethod;
  return untaintedMethod.bind(instance2);
}
function ownerDocument(n2) {
  return getUntaintedAccessor("Node", n2, "ownerDocument");
}
function childNodes(n2) {
  return getUntaintedAccessor("Node", n2, "childNodes");
}
function parentNode(n2) {
  return getUntaintedAccessor("Node", n2, "parentNode");
}
function parentElement(n2) {
  return getUntaintedAccessor("Node", n2, "parentElement");
}
function textContent(n2) {
  return getUntaintedAccessor("Node", n2, "textContent");
}
function contains(n2, other) {
  return getUntaintedMethod("Node", n2, "contains")(other);
}
function getRootNode(n2) {
  return getUntaintedMethod("Node", n2, "getRootNode")();
}
function host(n2) {
  if (!n2 || !("host" in n2)) return null;
  return getUntaintedAccessor("ShadowRoot", n2, "host");
}
function styleSheets(n2) {
  return n2.styleSheets;
}
function shadowRoot(n2) {
  if (!n2 || !("shadowRoot" in n2)) return null;
  return getUntaintedAccessor("Element", n2, "shadowRoot");
}
function querySelector(n2, selectors) {
  return getUntaintedAccessor("Element", n2, "querySelector")(selectors);
}
function querySelectorAll(n2, selectors) {
  return getUntaintedAccessor("Element", n2, "querySelectorAll")(selectors);
}
function mutationObserverCtor() {
  return getUntaintedPrototype("MutationObserver").constructor;
}
function patch(source, name, replacement) {
  try {
    if (!(name in source)) {
      return () => {
      };
    }
    const original = source[name];
    const wrapped = replacement(original);
    if (typeof wrapped === "function") {
      wrapped.prototype = wrapped.prototype || {};
      Object.defineProperties(wrapped, {
        __rrweb_original__: {
          enumerable: false,
          value: original
        }
      });
    }
    source[name] = wrapped;
    return () => {
      source[name] = original;
    };
  } catch (e2) {
    return () => {
    };
  }
}
const index = {
  ownerDocument,
  childNodes,
  parentNode,
  parentElement,
  textContent,
  contains,
  getRootNode,
  host,
  styleSheets,
  shadowRoot,
  querySelector,
  querySelectorAll,
  mutationObserver: mutationObserverCtor,
  patch
};
const DEPARTED_MIRROR_ACCESS_WARNING = "Please stop import mirror directly. Instead of that,\r\nnow you can use replayer.getMirror() to access the mirror instance of a replayer,\r\nor you can use record.mirror to access the mirror instance during recording.";
let _mirror = {
  map: {},
  getId() {
    console.error(DEPARTED_MIRROR_ACCESS_WARNING);
    return -1;
  },
  getNode() {
    console.error(DEPARTED_MIRROR_ACCESS_WARNING);
    return null;
  },
  removeNodeFromMap() {
    console.error(DEPARTED_MIRROR_ACCESS_WARNING);
  },
  has() {
    console.error(DEPARTED_MIRROR_ACCESS_WARNING);
    return false;
  },
  reset() {
    console.error(DEPARTED_MIRROR_ACCESS_WARNING);
  }
};
if (typeof window !== "undefined" && window.Proxy && window.Reflect) {
  _mirror = new Proxy(_mirror, {
    get(target, prop, receiver) {
      if (prop === "map") {
        console.error(DEPARTED_MIRROR_ACCESS_WARNING);
      }
      return Reflect.get(target, prop, receiver);
    }
  });
}
if (!/* @__PURE__ */ /[1-9][0-9]{12}/.test(Date.now().toString())) ;
function polyfill$1(win = window) {
  if ("NodeList" in win && !win.NodeList.prototype.forEach) {
    win.NodeList.prototype.forEach = Array.prototype.forEach;
  }
  if ("DOMTokenList" in win && !win.DOMTokenList.prototype.forEach) {
    win.DOMTokenList.prototype.forEach = Array.prototype.forEach;
  }
}
function queueToResolveTrees(queue) {
  const queueNodeMap = {};
  const putIntoMap = (m, parent) => {
    const nodeInTree = {
      value: m,
      parent,
      children: []
    };
    queueNodeMap[m.node.id] = nodeInTree;
    return nodeInTree;
  };
  const queueNodeTrees = [];
  for (const mutation of queue) {
    const { nextId, parentId } = mutation;
    if (nextId && nextId in queueNodeMap) {
      const nextInTree = queueNodeMap[nextId];
      if (nextInTree.parent) {
        const idx = nextInTree.parent.children.indexOf(nextInTree);
        nextInTree.parent.children.splice(
          idx,
          0,
          putIntoMap(mutation, nextInTree.parent)
        );
      } else {
        const idx = queueNodeTrees.indexOf(nextInTree);
        queueNodeTrees.splice(idx, 0, putIntoMap(mutation, null));
      }
      continue;
    }
    if (parentId in queueNodeMap) {
      const parentInTree = queueNodeMap[parentId];
      parentInTree.children.push(putIntoMap(mutation, parentInTree));
      continue;
    }
    queueNodeTrees.push(putIntoMap(mutation, null));
  }
  return queueNodeTrees;
}
function iterateResolveTree(tree, cb) {
  cb(tree.value);
  for (let i2 = tree.children.length - 1; i2 >= 0; i2--) {
    iterateResolveTree(tree.children[i2], cb);
  }
}
function isSerializedIframe(n2, mirror2) {
  return Boolean(n2.nodeName === "IFRAME" && mirror2.getMeta(n2));
}
function getBaseDimension(node2, rootIframe) {
  var _a2, _b2;
  const frameElement = (_b2 = (_a2 = node2.ownerDocument) == null ? void 0 : _a2.defaultView) == null ? void 0 : _b2.frameElement;
  if (!frameElement || frameElement === rootIframe) {
    return {
      x: 0,
      y: 0,
      relativeScale: 1,
      absoluteScale: 1
    };
  }
  const frameDimension = frameElement.getBoundingClientRect();
  const frameBaseDimension = getBaseDimension(frameElement, rootIframe);
  const relativeScale = frameDimension.height / frameElement.clientHeight;
  return {
    x: frameDimension.x * frameBaseDimension.relativeScale + frameBaseDimension.x,
    y: frameDimension.y * frameBaseDimension.relativeScale + frameBaseDimension.y,
    relativeScale,
    absoluteScale: frameBaseDimension.absoluteScale * relativeScale
  };
}
function hasShadowRoot(n2) {
  if (!n2) return false;
  if (n2 instanceof BaseRRNode && "shadowRoot" in n2) {
    return Boolean(n2.shadowRoot);
  }
  return Boolean(index.shadowRoot(n2));
}
function getNestedRule(rules2, position2) {
  const rule2 = rules2[position2[0]];
  if (position2.length === 1) {
    return rule2;
  } else {
    return getNestedRule(
      rule2.cssRules[position2[1]].cssRules,
      position2.slice(2)
    );
  }
}
function getPositionsAndIndex(nestedIndex) {
  const positions = [...nestedIndex];
  const index2 = positions.pop();
  return { positions, index: index2 };
}
function uniqueTextMutations(mutations) {
  const idSet = /* @__PURE__ */ new Set();
  const uniqueMutations = [];
  for (let i2 = mutations.length; i2--; ) {
    const mutation = mutations[i2];
    if (!idSet.has(mutation.id)) {
      uniqueMutations.push(mutation);
      idSet.add(mutation.id);
    }
  }
  return uniqueMutations;
}
class StyleSheetMirror {
  constructor() {
    __publicField2(this, "id", 1);
    __publicField2(this, "styleIDMap", /* @__PURE__ */ new WeakMap());
    __publicField2(this, "idStyleMap", /* @__PURE__ */ new Map());
  }
  getId(stylesheet) {
    var _a2;
    return (_a2 = this.styleIDMap.get(stylesheet)) != null ? _a2 : -1;
  }
  has(stylesheet) {
    return this.styleIDMap.has(stylesheet);
  }
  /**
   * @returns If the stylesheet is in the mirror, returns the id of the stylesheet. If not, return the new assigned id.
   */
  add(stylesheet, id) {
    if (this.has(stylesheet)) return this.getId(stylesheet);
    let newId;
    if (id === void 0) {
      newId = this.id++;
    } else newId = id;
    this.styleIDMap.set(stylesheet, newId);
    this.idStyleMap.set(newId, stylesheet);
    return newId;
  }
  getStyle(id) {
    return this.idStyleMap.get(id) || null;
  }
  reset() {
    this.styleIDMap = /* @__PURE__ */ new WeakMap();
    this.idStyleMap = /* @__PURE__ */ new Map();
    this.id = 1;
  }
  generateId() {
    return this.id++;
  }
}
var EventType$1 = /* @__PURE__ */ ((EventType2) => {
  EventType2[EventType2["DomContentLoaded"] = 0] = "DomContentLoaded";
  EventType2[EventType2["Load"] = 1] = "Load";
  EventType2[EventType2["FullSnapshot"] = 2] = "FullSnapshot";
  EventType2[EventType2["IncrementalSnapshot"] = 3] = "IncrementalSnapshot";
  EventType2[EventType2["Meta"] = 4] = "Meta";
  EventType2[EventType2["Custom"] = 5] = "Custom";
  EventType2[EventType2["Plugin"] = 6] = "Plugin";
  return EventType2;
})(EventType$1 || {});
var IncrementalSource$1 = /* @__PURE__ */ ((IncrementalSource2) => {
  IncrementalSource2[IncrementalSource2["Mutation"] = 0] = "Mutation";
  IncrementalSource2[IncrementalSource2["MouseMove"] = 1] = "MouseMove";
  IncrementalSource2[IncrementalSource2["MouseInteraction"] = 2] = "MouseInteraction";
  IncrementalSource2[IncrementalSource2["Scroll"] = 3] = "Scroll";
  IncrementalSource2[IncrementalSource2["ViewportResize"] = 4] = "ViewportResize";
  IncrementalSource2[IncrementalSource2["Input"] = 5] = "Input";
  IncrementalSource2[IncrementalSource2["TouchMove"] = 6] = "TouchMove";
  IncrementalSource2[IncrementalSource2["MediaInteraction"] = 7] = "MediaInteraction";
  IncrementalSource2[IncrementalSource2["StyleSheetRule"] = 8] = "StyleSheetRule";
  IncrementalSource2[IncrementalSource2["CanvasMutation"] = 9] = "CanvasMutation";
  IncrementalSource2[IncrementalSource2["Font"] = 10] = "Font";
  IncrementalSource2[IncrementalSource2["Log"] = 11] = "Log";
  IncrementalSource2[IncrementalSource2["Drag"] = 12] = "Drag";
  IncrementalSource2[IncrementalSource2["StyleDeclaration"] = 13] = "StyleDeclaration";
  IncrementalSource2[IncrementalSource2["Selection"] = 14] = "Selection";
  IncrementalSource2[IncrementalSource2["AdoptedStyleSheet"] = 15] = "AdoptedStyleSheet";
  IncrementalSource2[IncrementalSource2["CustomElement"] = 16] = "CustomElement";
  return IncrementalSource2;
})(IncrementalSource$1 || {});
var MouseInteractions = /* @__PURE__ */ ((MouseInteractions2) => {
  MouseInteractions2[MouseInteractions2["MouseUp"] = 0] = "MouseUp";
  MouseInteractions2[MouseInteractions2["MouseDown"] = 1] = "MouseDown";
  MouseInteractions2[MouseInteractions2["Click"] = 2] = "Click";
  MouseInteractions2[MouseInteractions2["ContextMenu"] = 3] = "ContextMenu";
  MouseInteractions2[MouseInteractions2["DblClick"] = 4] = "DblClick";
  MouseInteractions2[MouseInteractions2["Focus"] = 5] = "Focus";
  MouseInteractions2[MouseInteractions2["Blur"] = 6] = "Blur";
  MouseInteractions2[MouseInteractions2["TouchStart"] = 7] = "TouchStart";
  MouseInteractions2[MouseInteractions2["TouchMove_Departed"] = 8] = "TouchMove_Departed";
  MouseInteractions2[MouseInteractions2["TouchEnd"] = 9] = "TouchEnd";
  MouseInteractions2[MouseInteractions2["TouchCancel"] = 10] = "TouchCancel";
  return MouseInteractions2;
})(MouseInteractions || {});
var CanvasContext = /* @__PURE__ */ ((CanvasContext2) => {
  CanvasContext2[CanvasContext2["2D"] = 0] = "2D";
  CanvasContext2[CanvasContext2["WebGL"] = 1] = "WebGL";
  CanvasContext2[CanvasContext2["WebGL2"] = 2] = "WebGL2";
  return CanvasContext2;
})(CanvasContext || {});
var MediaInteractions = /* @__PURE__ */ ((MediaInteractions2) => {
  MediaInteractions2[MediaInteractions2["Play"] = 0] = "Play";
  MediaInteractions2[MediaInteractions2["Pause"] = 1] = "Pause";
  MediaInteractions2[MediaInteractions2["Seeked"] = 2] = "Seeked";
  MediaInteractions2[MediaInteractions2["VolumeChange"] = 3] = "VolumeChange";
  MediaInteractions2[MediaInteractions2["RateChange"] = 4] = "RateChange";
  return MediaInteractions2;
})(MediaInteractions || {});
var ReplayerEvents = /* @__PURE__ */ ((ReplayerEvents2) => {
  ReplayerEvents2["Start"] = "start";
  ReplayerEvents2["Pause"] = "pause";
  ReplayerEvents2["Resume"] = "resume";
  ReplayerEvents2["Resize"] = "resize";
  ReplayerEvents2["Finish"] = "finish";
  ReplayerEvents2["FullsnapshotRebuilded"] = "fullsnapshot-rebuilded";
  ReplayerEvents2["LoadStylesheetStart"] = "load-stylesheet-start";
  ReplayerEvents2["LoadStylesheetEnd"] = "load-stylesheet-end";
  ReplayerEvents2["SkipStart"] = "skip-start";
  ReplayerEvents2["SkipEnd"] = "skip-end";
  ReplayerEvents2["MouseInteraction"] = "mouse-interaction";
  ReplayerEvents2["EventCast"] = "event-cast";
  ReplayerEvents2["CustomEvent"] = "custom-event";
  ReplayerEvents2["Flush"] = "flush";
  ReplayerEvents2["StateChange"] = "state-change";
  ReplayerEvents2["PlayBack"] = "play-back";
  ReplayerEvents2["Destroy"] = "destroy";
  return ReplayerEvents2;
})(ReplayerEvents || {});
var NodeType = /* @__PURE__ */ ((NodeType2) => {
  NodeType2[NodeType2["Document"] = 0] = "Document";
  NodeType2[NodeType2["DocumentType"] = 1] = "DocumentType";
  NodeType2[NodeType2["Element"] = 2] = "Element";
  NodeType2[NodeType2["Text"] = 3] = "Text";
  NodeType2[NodeType2["CDATA"] = 4] = "CDATA";
  NodeType2[NodeType2["Comment"] = 5] = "Comment";
  return NodeType2;
})(NodeType || {});
var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
var lookup = typeof Uint8Array === "undefined" ? [] : new Uint8Array(256);
for (var i$1 = 0; i$1 < chars.length; i$1++) {
  lookup[chars.charCodeAt(i$1)] = i$1;
}
var decode = function(base64) {
  var bufferLength = base64.length * 0.75, len = base64.length, i2, p = 0, encoded1, encoded2, encoded3, encoded4;
  if (base64[base64.length - 1] === "=") {
    bufferLength--;
    if (base64[base64.length - 2] === "=") {
      bufferLength--;
    }
  }
  var arraybuffer = new ArrayBuffer(bufferLength), bytes = new Uint8Array(arraybuffer);
  for (i2 = 0; i2 < len; i2 += 4) {
    encoded1 = lookup[base64.charCodeAt(i2)];
    encoded2 = lookup[base64.charCodeAt(i2 + 1)];
    encoded3 = lookup[base64.charCodeAt(i2 + 2)];
    encoded4 = lookup[base64.charCodeAt(i2 + 3)];
    bytes[p++] = encoded1 << 2 | encoded2 >> 4;
    bytes[p++] = (encoded2 & 15) << 4 | encoded3 >> 2;
    bytes[p++] = (encoded3 & 3) << 6 | encoded4 & 63;
  }
  return arraybuffer;
};
const encodedJs = "KGZ1bmN0aW9uKCkgewogICJ1c2Ugc3RyaWN0IjsKICB2YXIgY2hhcnMgPSAiQUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ejAxMjM0NTY3ODkrLyI7CiAgdmFyIGxvb2t1cCA9IHR5cGVvZiBVaW50OEFycmF5ID09PSAidW5kZWZpbmVkIiA/IFtdIDogbmV3IFVpbnQ4QXJyYXkoMjU2KTsKICBmb3IgKHZhciBpID0gMDsgaSA8IGNoYXJzLmxlbmd0aDsgaSsrKSB7CiAgICBsb29rdXBbY2hhcnMuY2hhckNvZGVBdChpKV0gPSBpOwogIH0KICB2YXIgZW5jb2RlID0gZnVuY3Rpb24oYXJyYXlidWZmZXIpIHsKICAgIHZhciBieXRlcyA9IG5ldyBVaW50OEFycmF5KGFycmF5YnVmZmVyKSwgaTIsIGxlbiA9IGJ5dGVzLmxlbmd0aCwgYmFzZTY0ID0gIiI7CiAgICBmb3IgKGkyID0gMDsgaTIgPCBsZW47IGkyICs9IDMpIHsKICAgICAgYmFzZTY0ICs9IGNoYXJzW2J5dGVzW2kyXSA+PiAyXTsKICAgICAgYmFzZTY0ICs9IGNoYXJzWyhieXRlc1tpMl0gJiAzKSA8PCA0IHwgYnl0ZXNbaTIgKyAxXSA+PiA0XTsKICAgICAgYmFzZTY0ICs9IGNoYXJzWyhieXRlc1tpMiArIDFdICYgMTUpIDw8IDIgfCBieXRlc1tpMiArIDJdID4+IDZdOwogICAgICBiYXNlNjQgKz0gY2hhcnNbYnl0ZXNbaTIgKyAyXSAmIDYzXTsKICAgIH0KICAgIGlmIChsZW4gJSAzID09PSAyKSB7CiAgICAgIGJhc2U2NCA9IGJhc2U2NC5zdWJzdHJpbmcoMCwgYmFzZTY0Lmxlbmd0aCAtIDEpICsgIj0iOwogICAgfSBlbHNlIGlmIChsZW4gJSAzID09PSAxKSB7CiAgICAgIGJhc2U2NCA9IGJhc2U2NC5zdWJzdHJpbmcoMCwgYmFzZTY0Lmxlbmd0aCAtIDIpICsgIj09IjsKICAgIH0KICAgIHJldHVybiBiYXNlNjQ7CiAgfTsKICBjb25zdCBsYXN0QmxvYk1hcCA9IC8qIEBfX1BVUkVfXyAqLyBuZXcgTWFwKCk7CiAgY29uc3QgdHJhbnNwYXJlbnRCbG9iTWFwID0gLyogQF9fUFVSRV9fICovIG5ldyBNYXAoKTsKICBhc3luYyBmdW5jdGlvbiBnZXRUcmFuc3BhcmVudEJsb2JGb3Iod2lkdGgsIGhlaWdodCwgZGF0YVVSTE9wdGlvbnMpIHsKICAgIGNvbnN0IGlkID0gYCR7d2lkdGh9LSR7aGVpZ2h0fWA7CiAgICBpZiAoIk9mZnNjcmVlbkNhbnZhcyIgaW4gZ2xvYmFsVGhpcykgewogICAgICBpZiAodHJhbnNwYXJlbnRCbG9iTWFwLmhhcyhpZCkpIHJldHVybiB0cmFuc3BhcmVudEJsb2JNYXAuZ2V0KGlkKTsKICAgICAgY29uc3Qgb2Zmc2NyZWVuID0gbmV3IE9mZnNjcmVlbkNhbnZhcyh3aWR0aCwgaGVpZ2h0KTsKICAgICAgb2Zmc2NyZWVuLmdldENvbnRleHQoIjJkIik7CiAgICAgIGNvbnN0IGJsb2IgPSBhd2FpdCBvZmZzY3JlZW4uY29udmVydFRvQmxvYihkYXRhVVJMT3B0aW9ucyk7CiAgICAgIGNvbnN0IGFycmF5QnVmZmVyID0gYXdhaXQgYmxvYi5hcnJheUJ1ZmZlcigpOwogICAgICBjb25zdCBiYXNlNjQgPSBlbmNvZGUoYXJyYXlCdWZmZXIpOwogICAgICB0cmFuc3BhcmVudEJsb2JNYXAuc2V0KGlkLCBiYXNlNjQpOwogICAgICByZXR1cm4gYmFzZTY0OwogICAgfSBlbHNlIHsKICAgICAgcmV0dXJuICIiOwogICAgfQogIH0KICBjb25zdCB3b3JrZXIgPSBzZWxmOwogIHdvcmtlci5vbm1lc3NhZ2UgPSBhc3luYyBmdW5jdGlvbihlKSB7CiAgICBpZiAoIk9mZnNjcmVlbkNhbnZhcyIgaW4gZ2xvYmFsVGhpcykgewogICAgICBjb25zdCB7IGlkLCBiaXRtYXAsIHdpZHRoLCBoZWlnaHQsIGRhdGFVUkxPcHRpb25zIH0gPSBlLmRhdGE7CiAgICAgIGNvbnN0IHRyYW5zcGFyZW50QmFzZTY0ID0gZ2V0VHJhbnNwYXJlbnRCbG9iRm9yKAogICAgICAgIHdpZHRoLAogICAgICAgIGhlaWdodCwKICAgICAgICBkYXRhVVJMT3B0aW9ucwogICAgICApOwogICAgICBjb25zdCBvZmZzY3JlZW4gPSBuZXcgT2Zmc2NyZWVuQ2FudmFzKHdpZHRoLCBoZWlnaHQpOwogICAgICBjb25zdCBjdHggPSBvZmZzY3JlZW4uZ2V0Q29udGV4dCgiMmQiKTsKICAgICAgY3R4LmRyYXdJbWFnZShiaXRtYXAsIDAsIDApOwogICAgICBiaXRtYXAuY2xvc2UoKTsKICAgICAgY29uc3QgYmxvYiA9IGF3YWl0IG9mZnNjcmVlbi5jb252ZXJ0VG9CbG9iKGRhdGFVUkxPcHRpb25zKTsKICAgICAgY29uc3QgdHlwZSA9IGJsb2IudHlwZTsKICAgICAgY29uc3QgYXJyYXlCdWZmZXIgPSBhd2FpdCBibG9iLmFycmF5QnVmZmVyKCk7CiAgICAgIGNvbnN0IGJhc2U2NCA9IGVuY29kZShhcnJheUJ1ZmZlcik7CiAgICAgIGlmICghbGFzdEJsb2JNYXAuaGFzKGlkKSAmJiBhd2FpdCB0cmFuc3BhcmVudEJhc2U2NCA9PT0gYmFzZTY0KSB7CiAgICAgICAgbGFzdEJsb2JNYXAuc2V0KGlkLCBiYXNlNjQpOwogICAgICAgIHJldHVybiB3b3JrZXIucG9zdE1lc3NhZ2UoeyBpZCB9KTsKICAgICAgfQogICAgICBpZiAobGFzdEJsb2JNYXAuZ2V0KGlkKSA9PT0gYmFzZTY0KSByZXR1cm4gd29ya2VyLnBvc3RNZXNzYWdlKHsgaWQgfSk7CiAgICAgIHdvcmtlci5wb3N0TWVzc2FnZSh7CiAgICAgICAgaWQsCiAgICAgICAgdHlwZSwKICAgICAgICBiYXNlNjQsCiAgICAgICAgd2lkdGgsCiAgICAgICAgaGVpZ2h0CiAgICAgIH0pOwogICAgICBsYXN0QmxvYk1hcC5zZXQoaWQsIGJhc2U2NCk7CiAgICB9IGVsc2UgewogICAgICByZXR1cm4gd29ya2VyLnBvc3RNZXNzYWdlKHsgaWQ6IGUuZGF0YS5pZCB9KTsKICAgIH0KICB9Owp9KSgpOwovLyMgc291cmNlTWFwcGluZ1VSTD1pbWFnZS1iaXRtYXAtZGF0YS11cmwtd29ya2VyLUlKcEM3Z19iLmpzLm1hcAo=";
const decodeBase64 = (base64) => Uint8Array.from(atob(base64), (c2) => c2.charCodeAt(0));
typeof window !== "undefined" && window.Blob && new Blob([decodeBase64(encodedJs)], { type: "text/javascript;charset=utf-8" });
try {
  if (Array.from([1], (x2) => x2 * 2)[0] !== 2) {
    const cleanFrame = document.createElement("iframe");
    document.body.appendChild(cleanFrame);
    Array.from = ((_a$1 = cleanFrame.contentWindow) == null ? void 0 : _a$1.Array.from) || Array.from;
    document.body.removeChild(cleanFrame);
  }
} catch (err) {
  console.debug("Unable to override Array.from", err);
}
createMirror$2();
function mitt$1(n2) {
  return { all: n2 = n2 || /* @__PURE__ */ new Map(), on: function(t2, e2) {
    var i2 = n2.get(t2);
    i2 ? i2.push(e2) : n2.set(t2, [e2]);
  }, off: function(t2, e2) {
    var i2 = n2.get(t2);
    i2 && (e2 ? i2.splice(i2.indexOf(e2) >>> 0, 1) : n2.set(t2, []));
  }, emit: function(t2, e2) {
    var i2 = n2.get(t2);
    i2 && i2.slice().map(function(n3) {
      n3(e2);
    }), (i2 = n2.get("*")) && i2.slice().map(function(n3) {
      n3(t2, e2);
    });
  } };
}
const mittProxy = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: mitt$1
}, Symbol.toStringTag, { value: "Module" }));
function polyfill(w = window, d = document) {
  if ("scrollBehavior" in d.documentElement.style && w.__forceSmoothScrollPolyfill__ !== true) {
    return;
  }
  const Element2 = w.HTMLElement || w.Element;
  const SCROLL_TIME = 468;
  const original = {
    scroll: w.scroll || w.scrollTo,
    scrollBy: w.scrollBy,
    elementScroll: Element2.prototype.scroll || scrollElement,
    scrollIntoView: Element2.prototype.scrollIntoView
  };
  const now = w.performance && w.performance.now ? w.performance.now.bind(w.performance) : Date.now;
  function isMicrosoftBrowser(userAgent) {
    const userAgentPatterns = ["MSIE ", "Trident/", "Edge/"];
    return new RegExp(userAgentPatterns.join("|")).test(userAgent);
  }
  const ROUNDING_TOLERANCE = isMicrosoftBrowser(w.navigator.userAgent) ? 1 : 0;
  function scrollElement(x2, y) {
    this.scrollLeft = x2;
    this.scrollTop = y;
  }
  function ease(k) {
    return 0.5 * (1 - Math.cos(Math.PI * k));
  }
  function shouldBailOut(firstArg) {
    if (firstArg === null || typeof firstArg !== "object" || firstArg.behavior === void 0 || firstArg.behavior === "auto" || firstArg.behavior === "instant") {
      return true;
    }
    if (typeof firstArg === "object" && firstArg.behavior === "smooth") {
      return false;
    }
    throw new TypeError(
      "behavior member of ScrollOptions " + firstArg.behavior + " is not a valid value for enumeration ScrollBehavior."
    );
  }
  function hasScrollableSpace(el, axis) {
    if (axis === "Y") {
      return el.clientHeight + ROUNDING_TOLERANCE < el.scrollHeight;
    }
    if (axis === "X") {
      return el.clientWidth + ROUNDING_TOLERANCE < el.scrollWidth;
    }
  }
  function canOverflow(el, axis) {
    const overflowValue = w.getComputedStyle(el, null)["overflow" + axis];
    return overflowValue === "auto" || overflowValue === "scroll";
  }
  function isScrollable(el) {
    const isScrollableY = hasScrollableSpace(el, "Y") && canOverflow(el, "Y");
    const isScrollableX = hasScrollableSpace(el, "X") && canOverflow(el, "X");
    return isScrollableY || isScrollableX;
  }
  function findScrollableParent(el) {
    while (el !== d.body && isScrollable(el) === false) {
      el = el.parentNode || el.host;
    }
    return el;
  }
  function step(context) {
    const time = now();
    let value;
    let currentX;
    let currentY;
    let elapsed = (time - context.startTime) / SCROLL_TIME;
    elapsed = elapsed > 1 ? 1 : elapsed;
    value = ease(elapsed);
    currentX = context.startX + (context.x - context.startX) * value;
    currentY = context.startY + (context.y - context.startY) * value;
    context.method.call(context.scrollable, currentX, currentY);
    if (currentX !== context.x || currentY !== context.y) {
      w.requestAnimationFrame(step.bind(w, context));
    }
  }
  function smoothScroll(el, x2, y) {
    let scrollable;
    let startX;
    let startY;
    let method;
    const startTime = now();
    if (el === d.body) {
      scrollable = w;
      startX = w.scrollX || w.pageXOffset;
      startY = w.scrollY || w.pageYOffset;
      method = original.scroll;
    } else {
      scrollable = el;
      startX = el.scrollLeft;
      startY = el.scrollTop;
      method = scrollElement;
    }
    step({
      scrollable,
      method,
      startTime,
      startX,
      startY,
      x: x2,
      y
    });
  }
  w.scroll = w.scrollTo = function() {
    if (arguments[0] === void 0) {
      return;
    }
    if (shouldBailOut(arguments[0]) === true) {
      original.scroll.call(
        w,
        arguments[0].left !== void 0 ? arguments[0].left : typeof arguments[0] !== "object" ? arguments[0] : w.scrollX || w.pageXOffset,
        // use top prop, second argument if present or fallback to scrollY
        arguments[0].top !== void 0 ? arguments[0].top : arguments[1] !== void 0 ? arguments[1] : w.scrollY || w.pageYOffset
      );
      return;
    }
    smoothScroll.call(
      w,
      d.body,
      arguments[0].left !== void 0 ? ~~arguments[0].left : w.scrollX || w.pageXOffset,
      arguments[0].top !== void 0 ? ~~arguments[0].top : w.scrollY || w.pageYOffset
    );
  };
  w.scrollBy = function() {
    if (arguments[0] === void 0) {
      return;
    }
    if (shouldBailOut(arguments[0])) {
      original.scrollBy.call(
        w,
        arguments[0].left !== void 0 ? arguments[0].left : typeof arguments[0] !== "object" ? arguments[0] : 0,
        arguments[0].top !== void 0 ? arguments[0].top : arguments[1] !== void 0 ? arguments[1] : 0
      );
      return;
    }
    smoothScroll.call(
      w,
      d.body,
      ~~arguments[0].left + (w.scrollX || w.pageXOffset),
      ~~arguments[0].top + (w.scrollY || w.pageYOffset)
    );
  };
  Element2.prototype.scroll = Element2.prototype.scrollTo = function() {
    if (arguments[0] === void 0) {
      return;
    }
    if (shouldBailOut(arguments[0]) === true) {
      if (typeof arguments[0] === "number" && arguments[1] === void 0) {
        throw new SyntaxError("Value could not be converted");
      }
      original.elementScroll.call(
        this,
        // use left prop, first number argument or fallback to scrollLeft
        arguments[0].left !== void 0 ? ~~arguments[0].left : typeof arguments[0] !== "object" ? ~~arguments[0] : this.scrollLeft,
        // use top prop, second argument or fallback to scrollTop
        arguments[0].top !== void 0 ? ~~arguments[0].top : arguments[1] !== void 0 ? ~~arguments[1] : this.scrollTop
      );
      return;
    }
    const left = arguments[0].left;
    const top = arguments[0].top;
    smoothScroll.call(
      this,
      this,
      typeof left === "undefined" ? this.scrollLeft : ~~left,
      typeof top === "undefined" ? this.scrollTop : ~~top
    );
  };
  Element2.prototype.scrollBy = function() {
    if (arguments[0] === void 0) {
      return;
    }
    if (shouldBailOut(arguments[0]) === true) {
      original.elementScroll.call(
        this,
        arguments[0].left !== void 0 ? ~~arguments[0].left + this.scrollLeft : ~~arguments[0] + this.scrollLeft,
        arguments[0].top !== void 0 ? ~~arguments[0].top + this.scrollTop : ~~arguments[1] + this.scrollTop
      );
      return;
    }
    this.scroll({
      left: ~~arguments[0].left + this.scrollLeft,
      top: ~~arguments[0].top + this.scrollTop,
      behavior: arguments[0].behavior
    });
  };
  Element2.prototype.scrollIntoView = function() {
    if (shouldBailOut(arguments[0]) === true) {
      original.scrollIntoView.call(
        this,
        arguments[0] === void 0 ? true : arguments[0]
      );
      return;
    }
    const scrollableParent = findScrollableParent(this);
    const parentRects = scrollableParent.getBoundingClientRect();
    const clientRects = this.getBoundingClientRect();
    if (scrollableParent !== d.body) {
      smoothScroll.call(
        this,
        scrollableParent,
        scrollableParent.scrollLeft + clientRects.left - parentRects.left,
        scrollableParent.scrollTop + clientRects.top - parentRects.top
      );
      if (w.getComputedStyle(scrollableParent).position !== "fixed") {
        w.scrollBy({
          left: parentRects.left,
          top: parentRects.top,
          behavior: "smooth"
        });
      }
    } else {
      w.scrollBy({
        left: clientRects.left,
        top: clientRects.top,
        behavior: "smooth"
      });
    }
  };
}
class Timer {
  constructor(actions = [], config) {
    __publicField2(this, "timeOffset", 0);
    __publicField2(this, "speed");
    __publicField2(this, "actions");
    __publicField2(this, "raf", null);
    __publicField2(this, "lastTimestamp");
    this.actions = actions;
    this.speed = config.speed;
  }
  /**
   * Add an action, possibly after the timer starts.
   */
  addAction(action) {
    const rafWasActive = this.raf === true;
    if (!this.actions.length || this.actions[this.actions.length - 1].delay <= action.delay) {
      this.actions.push(action);
    } else {
      const index2 = this.findActionIndex(action);
      this.actions.splice(index2, 0, action);
    }
    if (rafWasActive) {
      this.raf = requestAnimationFrame(this.rafCheck.bind(this));
    }
  }
  start() {
    this.timeOffset = 0;
    this.lastTimestamp = performance.now();
    this.raf = requestAnimationFrame(this.rafCheck.bind(this));
  }
  rafCheck() {
    const time = performance.now();
    this.timeOffset += (time - this.lastTimestamp) * this.speed;
    this.lastTimestamp = time;
    while (this.actions.length) {
      const action = this.actions[0];
      if (this.timeOffset >= action.delay) {
        this.actions.shift();
        action.doAction();
      } else {
        break;
      }
    }
    if (this.actions.length > 0) {
      this.raf = requestAnimationFrame(this.rafCheck.bind(this));
    } else {
      this.raf = true;
    }
  }
  clear() {
    if (this.raf) {
      if (this.raf !== true) {
        cancelAnimationFrame(this.raf);
      }
      this.raf = null;
    }
    this.actions.length = 0;
  }
  setSpeed(speed) {
    this.speed = speed;
  }
  isActive() {
    return this.raf !== null;
  }
  findActionIndex(action) {
    let start = 0;
    let end = this.actions.length - 1;
    while (start <= end) {
      const mid = Math.floor((start + end) / 2);
      if (this.actions[mid].delay < action.delay) {
        start = mid + 1;
      } else if (this.actions[mid].delay > action.delay) {
        end = mid - 1;
      } else {
        return mid + 1;
      }
    }
    return start;
  }
}
function addDelay(event, baselineTime) {
  if (event.type === EventType$1.IncrementalSnapshot && event.data.source === IncrementalSource$1.MouseMove && event.data.positions && event.data.positions.length) {
    const firstOffset = event.data.positions[0].timeOffset;
    const firstTimestamp = event.timestamp + firstOffset;
    event.delay = firstTimestamp - baselineTime;
    return firstTimestamp - baselineTime;
  }
  event.delay = event.timestamp - baselineTime;
  return event.delay;
}
/*! *****************************************************************************
Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
***************************************************************************** */
function t(t2, n2) {
  var e2 = "function" == typeof Symbol && t2[Symbol.iterator];
  if (!e2) return t2;
  var r2, o2, i2 = e2.call(t2), a2 = [];
  try {
    for (; (void 0 === n2 || n2-- > 0) && !(r2 = i2.next()).done; ) a2.push(r2.value);
  } catch (t3) {
    o2 = { error: t3 };
  } finally {
    try {
      r2 && !r2.done && (e2 = i2.return) && e2.call(i2);
    } finally {
      if (o2) throw o2.error;
    }
  }
  return a2;
}
var n;
!function(t2) {
  t2[t2.NotStarted = 0] = "NotStarted", t2[t2.Running = 1] = "Running", t2[t2.Stopped = 2] = "Stopped";
}(n || (n = {}));
var e = { type: "xstate.init" };
function r(t2) {
  return void 0 === t2 ? [] : [].concat(t2);
}
function o(t2) {
  return { type: "xstate.assign", assignment: t2 };
}
function i$2(t2, n2) {
  return "string" == typeof (t2 = "string" == typeof t2 && n2 && n2[t2] ? n2[t2] : t2) ? { type: t2 } : "function" == typeof t2 ? { type: t2.name, exec: t2 } : t2;
}
function a(t2) {
  return function(n2) {
    return t2 === n2;
  };
}
function u(t2) {
  return "string" == typeof t2 ? { type: t2 } : t2;
}
function c(t2, n2) {
  return { value: t2, context: n2, actions: [], changed: false, matches: a(t2) };
}
function f(t2, n2, e2) {
  var r2 = n2, o2 = false;
  return [t2.filter(function(t3) {
    if ("xstate.assign" === t3.type) {
      o2 = true;
      var n3 = Object.assign({}, r2);
      return "function" == typeof t3.assignment ? n3 = t3.assignment(r2, e2) : Object.keys(t3.assignment).forEach(function(o3) {
        n3[o3] = "function" == typeof t3.assignment[o3] ? t3.assignment[o3](r2, e2) : t3.assignment[o3];
      }), r2 = n3, false;
    }
    return true;
  }), r2, o2];
}
function s(n2, o2) {
  void 0 === o2 && (o2 = {});
  var s2 = t(f(r(n2.states[n2.initial].entry).map(function(t2) {
    return i$2(t2, o2.actions);
  }), n2.context, e), 2), l2 = s2[0], v2 = s2[1], y = { config: n2, _options: o2, initialState: { value: n2.initial, actions: l2, context: v2, matches: a(n2.initial) }, transition: function(e2, o3) {
    var s3, l3, v3 = "string" == typeof e2 ? { value: e2, context: n2.context } : e2, p = v3.value, g = v3.context, d = u(o3), x2 = n2.states[p];
    if (x2.on) {
      var m = r(x2.on[d.type]);
      try {
        for (var h = function(t2) {
          var n3 = "function" == typeof Symbol && Symbol.iterator, e3 = n3 && t2[n3], r2 = 0;
          if (e3) return e3.call(t2);
          if (t2 && "number" == typeof t2.length) return { next: function() {
            return t2 && r2 >= t2.length && (t2 = void 0), { value: t2 && t2[r2++], done: !t2 };
          } };
          throw new TypeError(n3 ? "Object is not iterable." : "Symbol.iterator is not defined.");
        }(m), b = h.next(); !b.done; b = h.next()) {
          var S = b.value;
          if (void 0 === S) return c(p, g);
          var w = "string" == typeof S ? { target: S } : S, j = w.target, E = w.actions, R = void 0 === E ? [] : E, N = w.cond, O = void 0 === N ? function() {
            return true;
          } : N, _ = void 0 === j, k = null != j ? j : p, T = n2.states[k];
          if (O(g, d)) {
            var q = t(f((_ ? r(R) : [].concat(x2.exit, R, T.entry).filter(function(t2) {
              return t2;
            })).map(function(t2) {
              return i$2(t2, y._options.actions);
            }), g, d), 3), z = q[0], A = q[1], B = q[2], C = null != j ? j : p;
            return { value: C, context: A, actions: z, changed: j !== p || z.length > 0 || B, matches: a(C) };
          }
        }
      } catch (t2) {
        s3 = { error: t2 };
      } finally {
        try {
          b && !b.done && (l3 = h.return) && l3.call(h);
        } finally {
          if (s3) throw s3.error;
        }
      }
    }
    return c(p, g);
  } };
  return y;
}
var l = function(t2, n2) {
  return t2.actions.forEach(function(e2) {
    var r2 = e2.exec;
    return r2 && r2(t2.context, n2);
  });
};
function v(t2) {
  var r2 = t2.initialState, o2 = n.NotStarted, i2 = /* @__PURE__ */ new Set(), c2 = { _machine: t2, send: function(e2) {
    o2 === n.Running && (r2 = t2.transition(r2, e2), l(r2, u(e2)), i2.forEach(function(t3) {
      return t3(r2);
    }));
  }, subscribe: function(t3) {
    return i2.add(t3), t3(r2), { unsubscribe: function() {
      return i2.delete(t3);
    } };
  }, start: function(i3) {
    if (i3) {
      var u2 = "object" == typeof i3 ? i3 : { context: t2.config.context, value: i3 };
      r2 = { value: u2.value, actions: [], context: u2.context, matches: a(u2.value) };
    }
    return o2 = n.Running, l(r2, e), c2;
  }, stop: function() {
    return o2 = n.Stopped, i2.clear(), c2;
  }, get state() {
    return r2;
  }, get status() {
    return o2;
  } };
  return c2;
}
function discardPriorSnapshots(events, baselineTime) {
  for (let idx = events.length - 1; idx >= 0; idx--) {
    const event = events[idx];
    if (event.type === EventType$1.Meta) {
      if (event.timestamp <= baselineTime) {
        return events.slice(idx);
      }
    }
  }
  return events;
}
function createPlayerService(context, { getCastFn, applyEventsSynchronously, emitter }) {
  const playerMachine = s(
    {
      id: "player",
      context,
      initial: "paused",
      states: {
        playing: {
          on: {
            PAUSE: {
              target: "paused",
              actions: ["pause"]
            },
            CAST_EVENT: {
              target: "playing",
              actions: "castEvent"
            },
            END: {
              target: "paused",
              actions: ["resetLastPlayedEvent", "pause"]
            },
            ADD_EVENT: {
              target: "playing",
              actions: ["addEvent"]
            }
          }
        },
        paused: {
          on: {
            PLAY: {
              target: "playing",
              actions: ["recordTimeOffset", "play"]
            },
            CAST_EVENT: {
              target: "paused",
              actions: "castEvent"
            },
            TO_LIVE: {
              target: "live",
              actions: ["startLive"]
            },
            ADD_EVENT: {
              target: "paused",
              actions: ["addEvent"]
            }
          }
        },
        live: {
          on: {
            ADD_EVENT: {
              target: "live",
              actions: ["addEvent"]
            },
            CAST_EVENT: {
              target: "live",
              actions: ["castEvent"]
            }
          }
        }
      }
    },
    {
      actions: {
        castEvent: o({
          lastPlayedEvent: (ctx, event) => {
            if (event.type === "CAST_EVENT") {
              return event.payload.event;
            }
            return ctx.lastPlayedEvent;
          }
        }),
        recordTimeOffset: o((ctx, event) => {
          let timeOffset = ctx.timeOffset;
          if ("payload" in event && "timeOffset" in event.payload) {
            timeOffset = event.payload.timeOffset;
          }
          return __spreadProps(__spreadValues({}, ctx), {
            timeOffset,
            baselineTime: ctx.events[0].timestamp + timeOffset
          });
        }),
        play(ctx) {
          var _a2;
          const { timer, events, baselineTime, lastPlayedEvent } = ctx;
          timer.clear();
          for (const event of events) {
            addDelay(event, baselineTime);
          }
          const neededEvents = discardPriorSnapshots(events, baselineTime);
          let lastPlayedTimestamp = lastPlayedEvent == null ? void 0 : lastPlayedEvent.timestamp;
          if ((lastPlayedEvent == null ? void 0 : lastPlayedEvent.type) === EventType$1.IncrementalSnapshot && lastPlayedEvent.data.source === IncrementalSource$1.MouseMove) {
            lastPlayedTimestamp = lastPlayedEvent.timestamp + ((_a2 = lastPlayedEvent.data.positions[0]) == null ? void 0 : _a2.timeOffset);
          }
          if (baselineTime < (lastPlayedTimestamp || 0)) {
            emitter.emit(ReplayerEvents.PlayBack);
          }
          const syncEvents = new Array();
          for (const event of neededEvents) {
            if (lastPlayedTimestamp && lastPlayedTimestamp < baselineTime && (event.timestamp <= lastPlayedTimestamp || event === lastPlayedEvent)) {
              continue;
            }
            if (event.timestamp < baselineTime) {
              syncEvents.push(event);
            } else {
              const castFn = getCastFn(event, false);
              timer.addAction({
                doAction: () => {
                  castFn();
                },
                delay: event.delay
              });
            }
          }
          applyEventsSynchronously(syncEvents);
          emitter.emit(ReplayerEvents.Flush);
          timer.start();
        },
        pause(ctx) {
          ctx.timer.clear();
        },
        resetLastPlayedEvent: o((ctx) => {
          return __spreadProps(__spreadValues({}, ctx), {
            lastPlayedEvent: null
          });
        }),
        startLive: o({
          baselineTime: (ctx, event) => {
            ctx.timer.start();
            if (event.type === "TO_LIVE" && event.payload.baselineTime) {
              return event.payload.baselineTime;
            }
            return Date.now();
          }
        }),
        addEvent: o((ctx, machineEvent) => {
          const { baselineTime, timer, events } = ctx;
          if (machineEvent.type === "ADD_EVENT") {
            const { event } = machineEvent.payload;
            addDelay(event, baselineTime);
            let end = events.length - 1;
            if (!events[end] || events[end].timestamp <= event.timestamp) {
              events.push(event);
            } else {
              let insertionIndex = -1;
              let start = 0;
              while (start <= end) {
                const mid = Math.floor((start + end) / 2);
                if (events[mid].timestamp <= event.timestamp) {
                  start = mid + 1;
                } else {
                  end = mid - 1;
                }
              }
              if (insertionIndex === -1) {
                insertionIndex = start;
              }
              events.splice(insertionIndex, 0, event);
            }
            const isSync = event.timestamp < baselineTime;
            const castFn = getCastFn(event, isSync);
            if (isSync) {
              castFn();
            } else if (timer.isActive()) {
              timer.addAction({
                doAction: () => {
                  castFn();
                },
                delay: event.delay
              });
            }
          }
          return __spreadProps(__spreadValues({}, ctx), { events });
        })
      }
    }
  );
  return v(playerMachine);
}
function createSpeedService(context) {
  const speedMachine = s(
    {
      id: "speed",
      context,
      initial: "normal",
      states: {
        normal: {
          on: {
            FAST_FORWARD: {
              target: "skipping",
              actions: ["recordSpeed", "setSpeed"]
            },
            SET_SPEED: {
              target: "normal",
              actions: ["setSpeed"]
            }
          }
        },
        skipping: {
          on: {
            BACK_TO_NORMAL: {
              target: "normal",
              actions: ["restoreSpeed"]
            },
            SET_SPEED: {
              target: "normal",
              actions: ["setSpeed"]
            }
          }
        }
      }
    },
    {
      actions: {
        setSpeed: (ctx, event) => {
          if ("payload" in event) {
            ctx.timer.setSpeed(event.payload.speed);
          }
        },
        recordSpeed: o({
          normalSpeed: (ctx) => ctx.timer.speed
        }),
        restoreSpeed: (ctx) => {
          ctx.timer.setSpeed(ctx.normalSpeed);
        }
      }
    }
  );
  return v(speedMachine);
}
const rules = (blockClass) => [
  `.${blockClass} { background: currentColor }`,
  "noscript { display: none !important; }"
];
const webGLVarMap = /* @__PURE__ */ new Map();
function variableListFor(ctx, ctor) {
  let contextMap = webGLVarMap.get(ctx);
  if (!contextMap) {
    contextMap = /* @__PURE__ */ new Map();
    webGLVarMap.set(ctx, contextMap);
  }
  if (!contextMap.has(ctor)) {
    contextMap.set(ctor, []);
  }
  return contextMap.get(ctor);
}
function deserializeArg(imageMap, ctx, preload) {
  return async (arg) => {
    if (arg && typeof arg === "object" && "rr_type" in arg) {
      if (preload) preload.isUnchanged = false;
      if (arg.rr_type === "ImageBitmap" && "args" in arg) {
        const args = await deserializeArg(imageMap, ctx, preload)(arg.args);
        return await createImageBitmap.apply(null, args);
      } else if ("index" in arg) {
        if (preload || ctx === null) return arg;
        const { rr_type: name, index: index2 } = arg;
        return variableListFor(ctx, name)[index2];
      } else if ("args" in arg) {
        const { rr_type: name, args } = arg;
        const ctor = window[name];
        return new ctor(
          ...await Promise.all(
            args.map(deserializeArg(imageMap, ctx, preload))
          )
        );
      } else if ("base64" in arg) {
        return decode(arg.base64);
      } else if ("src" in arg) {
        const image = imageMap.get(arg.src);
        if (image) {
          return image;
        } else {
          const image2 = new Image();
          image2.src = arg.src;
          imageMap.set(arg.src, image2);
          return image2;
        }
      } else if ("data" in arg && arg.rr_type === "Blob") {
        const blobContents = await Promise.all(
          arg.data.map(deserializeArg(imageMap, ctx, preload))
        );
        const blob2 = new Blob(blobContents, {
          type: arg.type
        });
        return blob2;
      }
    } else if (Array.isArray(arg)) {
      const result2 = await Promise.all(
        arg.map(deserializeArg(imageMap, ctx, preload))
      );
      return result2;
    }
    return arg;
  };
}
function getContext(target, type) {
  try {
    if (type === CanvasContext.WebGL) {
      return target.getContext("webgl") || target.getContext("experimental-webgl");
    }
    return target.getContext("webgl2");
  } catch (e2) {
    return null;
  }
}
const WebGLVariableConstructorsNames = [
  "WebGLActiveInfo",
  "WebGLBuffer",
  "WebGLFramebuffer",
  "WebGLProgram",
  "WebGLRenderbuffer",
  "WebGLShader",
  "WebGLShaderPrecisionFormat",
  "WebGLTexture",
  "WebGLUniformLocation",
  "WebGLVertexArrayObject"
];
function saveToWebGLVarMap(ctx, result2) {
  if (!(result2 == null ? void 0 : result2.constructor)) return;
  const { name } = result2.constructor;
  if (!WebGLVariableConstructorsNames.includes(name)) return;
  const variables = variableListFor(ctx, name);
  if (!variables.includes(result2)) variables.push(result2);
}
async function webglMutation({
  mutation,
  target,
  type,
  imageMap,
  errorHandler: errorHandler2
}) {
  try {
    const ctx = getContext(target, type);
    if (!ctx) return;
    if (mutation.setter) {
      ctx[mutation.property] = mutation.args[0];
      return;
    }
    const original = ctx[mutation.property];
    const args = await Promise.all(
      mutation.args.map(deserializeArg(imageMap, ctx))
    );
    const result2 = original.apply(ctx, args);
    saveToWebGLVarMap(ctx, result2);
    const debugMode = false;
    if (debugMode) ;
  } catch (error) {
    errorHandler2(mutation, error);
  }
}
async function canvasMutation$1({
  event,
  mutations,
  target,
  imageMap,
  errorHandler: errorHandler2
}) {
  const ctx = target.getContext("2d");
  if (!ctx) {
    errorHandler2(mutations[0], new Error("Canvas context is null"));
    return;
  }
  const mutationArgsPromises = mutations.map(
    async (mutation) => {
      return Promise.all(mutation.args.map(deserializeArg(imageMap, ctx)));
    }
  );
  const args = await Promise.all(mutationArgsPromises);
  args.forEach((args2, index2) => {
    const mutation = mutations[index2];
    try {
      if (mutation.setter) {
        ctx[mutation.property] = mutation.args[0];
        return;
      }
      const original = ctx[mutation.property];
      if (mutation.property === "drawImage" && typeof mutation.args[0] === "string") {
        imageMap.get(event);
        original.apply(ctx, mutation.args);
      } else {
        original.apply(ctx, args2);
      }
    } catch (error) {
      errorHandler2(mutation, error);
    }
    return;
  });
}
async function canvasMutation({
  event,
  mutation,
  target,
  imageMap,
  canvasEventMap,
  errorHandler: errorHandler2
}) {
  try {
    const precomputedMutation = canvasEventMap.get(event) || mutation;
    const commands = "commands" in precomputedMutation ? precomputedMutation.commands : [precomputedMutation];
    if ([CanvasContext.WebGL, CanvasContext.WebGL2].includes(mutation.type)) {
      for (let i2 = 0; i2 < commands.length; i2++) {
        const command = commands[i2];
        await webglMutation({
          mutation: command,
          type: mutation.type,
          target,
          imageMap,
          errorHandler: errorHandler2
        });
      }
      return;
    }
    await canvasMutation$1({
      event,
      mutations: commands,
      target,
      imageMap,
      errorHandler: errorHandler2
    });
  } catch (error) {
    errorHandler2(mutation, error);
  }
}
class MediaManager {
  constructor(options) {
    __publicField2(this, "mediaMap", /* @__PURE__ */ new Map());
    __publicField2(this, "warn");
    __publicField2(this, "service");
    __publicField2(this, "speedService");
    __publicField2(this, "emitter");
    __publicField2(this, "getCurrentTime");
    __publicField2(this, "metadataCallbackMap", /* @__PURE__ */ new Map());
    this.warn = options.warn;
    this.service = options.service;
    this.speedService = options.speedService;
    this.emitter = options.emitter;
    this.getCurrentTime = options.getCurrentTime;
    this.emitter.on(ReplayerEvents.Start, this.start.bind(this));
    this.emitter.on(ReplayerEvents.SkipStart, this.start.bind(this));
    this.emitter.on(ReplayerEvents.Pause, this.pause.bind(this));
    this.emitter.on(ReplayerEvents.Finish, this.pause.bind(this));
    this.speedService.subscribe(() => {
      this.syncAllMediaElements();
    });
  }
  syncAllMediaElements(options = { pause: false }) {
    this.mediaMap.forEach((_mediaState, target) => {
      this.syncTargetWithState(target);
      if (options.pause) {
        target.pause();
      }
    });
  }
  start() {
    this.syncAllMediaElements();
  }
  pause() {
    this.syncAllMediaElements({ pause: true });
  }
  seekTo({
    time,
    target,
    mediaState
  }) {
    if (mediaState.isPlaying) {
      const differenceBetweenCurrentTimeAndMediaMutationTimestamp = time - mediaState.lastInteractionTimeOffset;
      const mediaPlaybackOffset = differenceBetweenCurrentTimeAndMediaMutationTimestamp / 1e3 * mediaState.playbackRate;
      const duration = "duration" in target && target.duration;
      if (Number.isNaN(duration)) {
        this.waitForMetadata(target);
        return;
      }
      let seekToTime = mediaState.currentTimeAtLastInteraction + mediaPlaybackOffset;
      if (target.loop && // RRMediaElement doesn't have a duration property
      duration !== false) {
        seekToTime = seekToTime % duration;
      }
      target.currentTime = seekToTime;
    } else {
      target.pause();
      target.currentTime = mediaState.currentTimeAtLastInteraction;
    }
  }
  waitForMetadata(target) {
    if (this.metadataCallbackMap.has(target)) return;
    if (!("addEventListener" in target)) return;
    const onLoadedMetadata = () => {
      this.metadataCallbackMap.delete(target);
      const mediaState = this.mediaMap.get(target);
      if (!mediaState) return;
      this.seekTo({
        time: this.getCurrentTime(),
        target,
        mediaState
      });
    };
    this.metadataCallbackMap.set(target, onLoadedMetadata);
    target.addEventListener("loadedmetadata", onLoadedMetadata, {
      once: true
    });
  }
  getMediaStateFromMutation({
    target,
    timeOffset,
    mutation
  }) {
    var _a2, _b2, _c, _d, _e;
    const lastState = this.mediaMap.get(target);
    const { type, playbackRate, currentTime, muted, volume, loop } = mutation;
    const isPlaying = type === MediaInteractions.Play || type !== MediaInteractions.Pause && ((lastState == null ? void 0 : lastState.isPlaying) || target.getAttribute("autoplay") !== null);
    const mediaState = {
      isPlaying,
      currentTimeAtLastInteraction: (_a2 = currentTime != null ? currentTime : lastState == null ? void 0 : lastState.currentTimeAtLastInteraction) != null ? _a2 : 0,
      lastInteractionTimeOffset: timeOffset,
      playbackRate: (_b2 = playbackRate != null ? playbackRate : lastState == null ? void 0 : lastState.playbackRate) != null ? _b2 : 1,
      volume: (_c = volume != null ? volume : lastState == null ? void 0 : lastState.volume) != null ? _c : 1,
      muted: (_d = muted != null ? muted : lastState == null ? void 0 : lastState.muted) != null ? _d : target.getAttribute("muted") === null,
      loop: (_e = loop != null ? loop : lastState == null ? void 0 : lastState.loop) != null ? _e : target.getAttribute("loop") === null
    };
    return mediaState;
  }
  syncTargetWithState(target) {
    const mediaState = this.mediaMap.get(target);
    if (!mediaState) return;
    const { muted, loop, volume, isPlaying } = mediaState;
    const playerIsPaused = this.service.state.matches("paused");
    const playbackRate = mediaState.playbackRate * this.speedService.state.context.timer.speed;
    try {
      this.seekTo({
        time: this.getCurrentTime(),
        target,
        mediaState
      });
      if (target.volume !== volume) {
        target.volume = volume;
      }
      target.muted = muted;
      target.loop = loop;
      if (target.playbackRate !== playbackRate) {
        target.playbackRate = playbackRate;
      }
      if (isPlaying && !playerIsPaused) {
        void target.play();
      } else {
        target.pause();
      }
    } catch (error) {
      this.warn(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/restrict-template-expressions
        `Failed to replay media interactions: ${error.message || error}`
      );
    }
  }
  addMediaElements(node2, timeOffset, mirror2) {
    if (!["AUDIO", "VIDEO"].includes(node2.nodeName)) return;
    const target = node2;
    const serializedNode = mirror2.getMeta(target);
    if (!serializedNode || !("attributes" in serializedNode)) return;
    const playerIsPaused = this.service.state.matches("paused");
    const mediaAttributes = serializedNode.attributes;
    let isPlaying = false;
    if (mediaAttributes.rr_mediaState) {
      isPlaying = mediaAttributes.rr_mediaState === "played";
    } else {
      isPlaying = target.getAttribute("autoplay") !== null;
    }
    if (isPlaying && playerIsPaused) target.pause();
    let playbackRate = 1;
    if (typeof mediaAttributes.rr_mediaPlaybackRate === "number") {
      playbackRate = mediaAttributes.rr_mediaPlaybackRate;
    }
    let muted = false;
    if (typeof mediaAttributes.rr_mediaMuted === "boolean") {
      muted = mediaAttributes.rr_mediaMuted;
    } else {
      muted = target.getAttribute("muted") !== null;
    }
    let loop = false;
    if (typeof mediaAttributes.rr_mediaLoop === "boolean") {
      loop = mediaAttributes.rr_mediaLoop;
    } else {
      loop = target.getAttribute("loop") !== null;
    }
    let volume = 1;
    if (typeof mediaAttributes.rr_mediaVolume === "number") {
      volume = mediaAttributes.rr_mediaVolume;
    }
    let currentTimeAtLastInteraction = 0;
    if (typeof mediaAttributes.rr_mediaCurrentTime === "number") {
      currentTimeAtLastInteraction = mediaAttributes.rr_mediaCurrentTime;
    }
    this.mediaMap.set(target, {
      isPlaying,
      currentTimeAtLastInteraction,
      lastInteractionTimeOffset: timeOffset,
      playbackRate,
      volume,
      muted,
      loop
    });
    this.syncTargetWithState(target);
  }
  mediaMutation({
    target,
    timeOffset,
    mutation
  }) {
    this.mediaMap.set(
      target,
      this.getMediaStateFromMutation({
        target,
        timeOffset,
        mutation
      })
    );
    this.syncTargetWithState(target);
  }
  isSupportedMediaElement(node2) {
    return ["AUDIO", "VIDEO"].includes(node2.nodeName);
  }
  reset() {
    this.mediaMap.clear();
  }
}
function applyDialogToTopLevel(node2, attributeMutation) {
  if (node2.nodeName !== "DIALOG" || node2 instanceof BaseRRNode) return;
  const dialog = node2;
  const oldIsOpen = dialog.open;
  const oldIsModalState = oldIsOpen && dialog.matches("dialog:modal");
  const rrOpenMode = dialog.getAttribute("rr_open_mode");
  const newIsOpen = typeof (attributeMutation == null ? void 0 : attributeMutation.attributes.open) === "string" || typeof dialog.getAttribute("open") === "string";
  const newIsModalState = rrOpenMode === "modal";
  const newIsNonModalState = rrOpenMode === "non-modal";
  const modalStateChanged = oldIsModalState && newIsNonModalState || !oldIsModalState && newIsModalState;
  if (oldIsOpen && !modalStateChanged) return;
  if (!dialog.isConnected) {
    console.warn("dialog is not attached to the dom", dialog);
    return;
  }
  if (oldIsOpen) dialog.close();
  if (!newIsOpen) return;
  if (newIsModalState) dialog.showModal();
  else dialog.show();
}
function removeDialogFromTopLevel(node2, attributeMutation) {
  if (node2.nodeName !== "DIALOG" || node2 instanceof BaseRRNode) return;
  const dialog = node2;
  if (!dialog.isConnected) {
    console.warn("dialog is not attached to the dom", dialog);
    return;
  }
  if (attributeMutation.attributes.open === null) {
    dialog.removeAttribute("open");
    dialog.removeAttribute("rr_open_mode");
  }
}
const SKIP_TIME_INTERVAL = 5 * 1e3;
const mitt = mitt$1 || mittProxy;
const REPLAY_CONSOLE_PREFIX = "[replayer]";
const defaultMouseTailConfig = {
  duration: 500,
  lineCap: "round",
  lineWidth: 3,
  strokeStyle: "red"
};
function indicatesTouchDevice(e2) {
  return e2.type == EventType$1.IncrementalSnapshot && (e2.data.source == IncrementalSource$1.TouchMove || e2.data.source == IncrementalSource$1.MouseInteraction && e2.data.type == MouseInteractions.TouchStart);
}
class Replayer {
  constructor(events, config) {
    __publicField2(this, "wrapper");
    __publicField2(this, "iframe");
    __publicField2(this, "service");
    __publicField2(this, "speedService");
    __publicField2(this, "config");
    __publicField2(this, "usingVirtualDom", false);
    __publicField2(this, "virtualDom", new RRDocument());
    __publicField2(this, "mouse");
    __publicField2(this, "mouseTail", null);
    __publicField2(this, "tailPositions", []);
    __publicField2(this, "emitter", mitt());
    __publicField2(this, "nextUserInteractionEvent");
    __publicField2(this, "legacy_missingNodeRetryMap", {});
    __publicField2(this, "cache", createCache());
    __publicField2(this, "imageMap", /* @__PURE__ */ new Map());
    __publicField2(this, "canvasEventMap", /* @__PURE__ */ new Map());
    __publicField2(this, "mirror", createMirror$2());
    __publicField2(this, "styleMirror", new StyleSheetMirror());
    __publicField2(this, "mediaManager");
    __publicField2(this, "firstFullSnapshot", null);
    __publicField2(this, "newDocumentQueue", []);
    __publicField2(this, "mousePos", null);
    __publicField2(this, "touchActive", null);
    __publicField2(this, "lastMouseDownEvent", null);
    __publicField2(this, "lastHoveredRootNode");
    __publicField2(this, "lastSelectionData", null);
    __publicField2(this, "constructedStyleMutations", []);
    __publicField2(this, "adoptedStyleSheets", []);
    __publicField2(this, "handleResize", (dimension) => {
      this.iframe.style.display = "inherit";
      for (const el of [this.mouseTail, this.iframe]) {
        if (!el) {
          continue;
        }
        el.setAttribute("width", String(dimension.width));
        el.setAttribute("height", String(dimension.height));
      }
    });
    __publicField2(this, "applyEventsSynchronously", (events2) => {
      for (const event of events2) {
        switch (event.type) {
          case EventType$1.DomContentLoaded:
          case EventType$1.Load:
          case EventType$1.Custom:
            continue;
          case EventType$1.FullSnapshot:
          case EventType$1.Meta:
          case EventType$1.Plugin:
          case EventType$1.IncrementalSnapshot:
            break;
        }
        const castFn = this.getCastFn(event, true);
        castFn();
      }
    });
    __publicField2(this, "getCastFn", (event, isSync = false) => {
      let castFn;
      switch (event.type) {
        case EventType$1.DomContentLoaded:
        case EventType$1.Load:
          break;
        case EventType$1.Custom:
          castFn = () => {
            this.emitter.emit(ReplayerEvents.CustomEvent, event);
          };
          break;
        case EventType$1.Meta:
          castFn = () => this.emitter.emit(ReplayerEvents.Resize, {
            width: event.data.width,
            height: event.data.height
          });
          break;
        case EventType$1.FullSnapshot:
          castFn = () => {
            var _a2;
            if (this.firstFullSnapshot) {
              if (this.firstFullSnapshot === event) {
                this.firstFullSnapshot = true;
                return;
              }
            } else {
              this.firstFullSnapshot = true;
            }
            this.mediaManager.reset();
            this.styleMirror.reset();
            this.rebuildFullSnapshot(event, isSync);
            (_a2 = this.iframe.contentWindow) == null ? void 0 : _a2.scrollTo(event.data.initialOffset);
          };
          break;
        case EventType$1.IncrementalSnapshot:
          castFn = () => {
            this.applyIncremental(event, isSync);
            if (isSync) {
              return;
            }
            if (event === this.nextUserInteractionEvent) {
              this.nextUserInteractionEvent = null;
              this.backToNormal();
            }
            if (this.config.skipInactive && !this.nextUserInteractionEvent) {
              for (const _event of this.service.state.context.events) {
                if (_event.timestamp <= event.timestamp) {
                  continue;
                }
                if (this.isUserInteraction(_event)) {
                  if (
                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                    _event.delay - event.delay > this.config.inactivePeriodThreshold * this.speedService.state.context.timer.speed
                  ) {
                    this.nextUserInteractionEvent = _event;
                  }
                  break;
                }
              }
              if (this.nextUserInteractionEvent) {
                const skipTime = (
                  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                  this.nextUserInteractionEvent.delay - event.delay
                );
                const payload = {
                  speed: Math.min(
                    Math.round(skipTime / SKIP_TIME_INTERVAL),
                    this.config.maxSpeed
                  )
                };
                this.speedService.send({ type: "FAST_FORWARD", payload });
                this.emitter.emit(ReplayerEvents.SkipStart, payload);
              }
            }
          };
          break;
      }
      const wrappedCastFn = () => {
        if (castFn) {
          castFn();
        }
        for (const plugin3 of this.config.plugins || []) {
          if (plugin3.handler) plugin3.handler(event, isSync, { replayer: this });
        }
        this.service.send({ type: "CAST_EVENT", payload: { event } });
        const lastIndex = this.service.state.context.events.length - 1;
        if (!this.config.liveMode && event === this.service.state.context.events[lastIndex]) {
          const finish = () => {
            if (lastIndex < this.service.state.context.events.length - 1) {
              return;
            }
            this.backToNormal();
            this.service.send("END");
            this.emitter.emit(ReplayerEvents.Finish);
          };
          let finishBuffer = 50;
          if (event.type === EventType$1.IncrementalSnapshot && event.data.source === IncrementalSource$1.MouseMove && event.data.positions.length) {
            finishBuffer += Math.max(0, -event.data.positions[0].timeOffset);
          }
          setTimeout(finish, finishBuffer);
        }
        this.emitter.emit(ReplayerEvents.EventCast, event);
      };
      return wrappedCastFn;
    });
    if (!(config == null ? void 0 : config.liveMode) && events.length < 2) {
      throw new Error("Replayer need at least 2 events.");
    }
    const defaultConfig = {
      speed: 1,
      maxSpeed: 360,
      root: document.body,
      loadTimeout: 0,
      skipInactive: false,
      inactivePeriodThreshold: 10 * 1e3,
      showWarning: true,
      showDebug: false,
      blockClass: "rr-block",
      liveMode: false,
      insertStyleRules: [],
      triggerFocus: true,
      UNSAFE_replayCanvas: false,
      pauseAnimation: true,
      mouseTail: defaultMouseTailConfig,
      useVirtualDom: true,
      // Virtual-dom optimization is enabled by default.
      logger: console
    };
    this.config = Object.assign({}, defaultConfig, config);
    this.handleResize = this.handleResize.bind(this);
    this.getCastFn = this.getCastFn.bind(this);
    this.applyEventsSynchronously = this.applyEventsSynchronously.bind(this);
    this.emitter.on(ReplayerEvents.Resize, this.handleResize);
    this.setupDom();
    for (const plugin3 of this.config.plugins || []) {
      if (plugin3.getMirror) plugin3.getMirror({ nodeMirror: this.mirror });
    }
    this.emitter.on(ReplayerEvents.Flush, () => {
      if (this.usingVirtualDom) {
        const replayerHandler = {
          mirror: this.mirror,
          applyCanvas: (canvasEvent, canvasMutationData, target) => {
            void canvasMutation({
              event: canvasEvent,
              mutation: canvasMutationData,
              target,
              imageMap: this.imageMap,
              canvasEventMap: this.canvasEventMap,
              errorHandler: this.warnCanvasMutationFailed.bind(this)
            });
          },
          applyInput: this.applyInput.bind(this),
          applyScroll: this.applyScroll.bind(this),
          applyStyleSheetMutation: (data, styleSheet) => {
            if (data.source === IncrementalSource$1.StyleSheetRule)
              this.applyStyleSheetRule(data, styleSheet);
            else if (data.source === IncrementalSource$1.StyleDeclaration)
              this.applyStyleDeclaration(data, styleSheet);
          },
          afterAppend: (node2, id) => {
            for (const plugin3 of this.config.plugins || []) {
              if (plugin3.onBuild) plugin3.onBuild(node2, { id, replayer: this });
            }
          }
        };
        if (this.iframe.contentDocument)
          try {
            diff(
              this.iframe.contentDocument,
              this.virtualDom,
              replayerHandler,
              this.virtualDom.mirror
            );
          } catch (e2) {
            console.warn(e2);
          }
        this.virtualDom.destroyTree();
        this.usingVirtualDom = false;
        if (Object.keys(this.legacy_missingNodeRetryMap).length) {
          for (const key in this.legacy_missingNodeRetryMap) {
            try {
              const value = this.legacy_missingNodeRetryMap[key];
              const realNode = createOrGetNode(
                value.node,
                this.mirror,
                this.virtualDom.mirror
              );
              diff(
                realNode,
                value.node,
                replayerHandler,
                this.virtualDom.mirror
              );
              value.node = realNode;
            } catch (error) {
              this.warn(error);
            }
          }
        }
        this.constructedStyleMutations.forEach((data) => {
          this.applyStyleSheetMutation(data);
        });
        this.constructedStyleMutations = [];
        this.adoptedStyleSheets.forEach((data) => {
          this.applyAdoptedStyleSheet(data);
        });
        this.adoptedStyleSheets = [];
      }
      if (this.mousePos) {
        this.moveAndHover(
          this.mousePos.x,
          this.mousePos.y,
          this.mousePos.id,
          true,
          this.mousePos.debugData
        );
        this.mousePos = null;
      }
      if (this.touchActive === true) {
        this.mouse.classList.add("touch-active");
      } else if (this.touchActive === false) {
        this.mouse.classList.remove("touch-active");
      }
      this.touchActive = null;
      if (this.lastMouseDownEvent) {
        const [target, event] = this.lastMouseDownEvent;
        target.dispatchEvent(event);
      }
      this.lastMouseDownEvent = null;
      if (this.lastSelectionData) {
        this.applySelection(this.lastSelectionData);
        this.lastSelectionData = null;
      }
    });
    this.emitter.on(ReplayerEvents.PlayBack, () => {
      this.firstFullSnapshot = null;
      this.mirror.reset();
      this.styleMirror.reset();
      this.mediaManager.reset();
    });
    const timer = new Timer([], {
      speed: this.config.speed
    });
    this.service = createPlayerService(
      {
        events: events.map((e2) => {
          if (config && config.unpackFn) {
            return config.unpackFn(e2);
          }
          return e2;
        }).sort((a1, a2) => a1.timestamp - a2.timestamp),
        timer,
        timeOffset: 0,
        baselineTime: 0,
        lastPlayedEvent: null
      },
      {
        getCastFn: this.getCastFn,
        applyEventsSynchronously: this.applyEventsSynchronously,
        emitter: this.emitter
      }
    );
    this.service.start();
    this.service.subscribe((state) => {
      this.emitter.emit(ReplayerEvents.StateChange, {
        player: state
      });
    });
    this.speedService = createSpeedService({
      normalSpeed: -1,
      timer
    });
    this.speedService.start();
    this.speedService.subscribe((state) => {
      this.emitter.emit(ReplayerEvents.StateChange, {
        speed: state
      });
    });
    this.mediaManager = new MediaManager({
      warn: this.warn.bind(this),
      service: this.service,
      speedService: this.speedService,
      emitter: this.emitter,
      getCurrentTime: this.getCurrentTime.bind(this)
    });
    const firstMeta = this.service.state.context.events.find(
      (e2) => e2.type === EventType$1.Meta
    );
    const firstFullsnapshot = this.service.state.context.events.find(
      (e2) => e2.type === EventType$1.FullSnapshot
    );
    if (firstMeta) {
      const { width, height } = firstMeta.data;
      setTimeout(() => {
        this.emitter.emit(ReplayerEvents.Resize, {
          width,
          height
        });
      }, 0);
    }
    if (firstFullsnapshot) {
      setTimeout(() => {
        var _a2;
        if (this.firstFullSnapshot) {
          return;
        }
        this.firstFullSnapshot = firstFullsnapshot;
        this.rebuildFullSnapshot(
          firstFullsnapshot
        );
        (_a2 = this.iframe.contentWindow) == null ? void 0 : _a2.scrollTo(
          firstFullsnapshot.data.initialOffset
        );
      }, 1);
    }
    if (this.service.state.context.events.find(indicatesTouchDevice)) {
      this.mouse.classList.add("touch-device");
    }
  }
  get timer() {
    return this.service.state.context.timer;
  }
  on(event, handler) {
    this.emitter.on(event, handler);
    return this;
  }
  off(event, handler) {
    this.emitter.off(event, handler);
    return this;
  }
  setConfig(config) {
    Object.keys(config).forEach((key) => {
      config[key];
      this.config[key] = config[key];
    });
    if (!this.config.skipInactive) {
      this.backToNormal();
    }
    if (typeof config.speed !== "undefined") {
      this.speedService.send({
        type: "SET_SPEED",
        payload: {
          speed: config.speed
        }
      });
    }
    if (typeof config.mouseTail !== "undefined") {
      if (config.mouseTail === false) {
        if (this.mouseTail) {
          this.mouseTail.style.display = "none";
        }
      } else {
        if (!this.mouseTail) {
          this.mouseTail = document.createElement("canvas");
          this.mouseTail.width = Number.parseFloat(this.iframe.width);
          this.mouseTail.height = Number.parseFloat(this.iframe.height);
          this.mouseTail.classList.add("replayer-mouse-tail");
          this.wrapper.insertBefore(this.mouseTail, this.iframe);
        }
        this.mouseTail.style.display = "inherit";
      }
    }
  }
  getMetaData() {
    const firstEvent = this.service.state.context.events[0];
    const lastEvent = this.service.state.context.events[this.service.state.context.events.length - 1];
    return {
      startTime: firstEvent.timestamp,
      endTime: lastEvent.timestamp,
      totalTime: lastEvent.timestamp - firstEvent.timestamp
    };
  }
  /**
   * Get the actual time offset the player is at now compared to the first event.
   */
  getCurrentTime() {
    return this.timer.timeOffset + this.getTimeOffset();
  }
  /**
   * Get the time offset the player is at now compared to the first event, but without regard for the timer.
   */
  getTimeOffset() {
    const { baselineTime, events } = this.service.state.context;
    return baselineTime - events[0].timestamp;
  }
  getMirror() {
    return this.mirror;
  }
  /**
   * This API was designed to be used as play at any time offset.
   * Since we minimized the data collected from recorder, we do not
   * have the ability of undo an event.
   * So the implementation of play at any time offset will always iterate
   * all of the events, cast event before the offset synchronously
   * and cast event after the offset asynchronously with timer.
   * @param timeOffset - number
   */
  play(timeOffset = 0) {
    var _a2, _b2;
    if (this.service.state.matches("paused")) {
      this.service.send({ type: "PLAY", payload: { timeOffset } });
    } else {
      this.service.send({ type: "PAUSE" });
      this.service.send({ type: "PLAY", payload: { timeOffset } });
    }
    (_b2 = (_a2 = this.iframe.contentDocument) == null ? void 0 : _a2.getElementsByTagName("html")[0]) == null ? void 0 : _b2.classList.remove("rrweb-paused");
    this.emitter.emit(ReplayerEvents.Start);
  }
  pause(timeOffset) {
    var _a2, _b2;
    if (timeOffset === void 0 && this.service.state.matches("playing")) {
      this.service.send({ type: "PAUSE" });
    }
    if (typeof timeOffset === "number") {
      this.play(timeOffset);
      this.service.send({ type: "PAUSE" });
    }
    (_b2 = (_a2 = this.iframe.contentDocument) == null ? void 0 : _a2.getElementsByTagName("html")[0]) == null ? void 0 : _b2.classList.add("rrweb-paused");
    this.emitter.emit(ReplayerEvents.Pause);
  }
  resume(timeOffset = 0) {
    this.warn(
      `The 'resume' was deprecated in 1.0. Please use 'play' method which has the same interface.`
    );
    this.play(timeOffset);
    this.emitter.emit(ReplayerEvents.Resume);
  }
  /**
   * Totally destroy this replayer and please be careful that this operation is irreversible.
   * Memory occupation can be released by removing all references to this replayer.
   */
  destroy() {
    this.pause();
    this.mirror.reset();
    this.styleMirror.reset();
    this.mediaManager.reset();
    this.config.root.removeChild(this.wrapper);
    this.emitter.emit(ReplayerEvents.Destroy);
  }
  startLive(baselineTime) {
    this.service.send({ type: "TO_LIVE", payload: { baselineTime } });
  }
  addEvent(rawEvent) {
    const event = this.config.unpackFn ? this.config.unpackFn(rawEvent) : rawEvent;
    if (indicatesTouchDevice(event)) {
      this.mouse.classList.add("touch-device");
    }
    void Promise.resolve().then(
      () => this.service.send({ type: "ADD_EVENT", payload: { event } })
    );
  }
  enableInteract() {
    this.iframe.setAttribute("scrolling", "auto");
    this.iframe.style.pointerEvents = "auto";
  }
  disableInteract() {
    this.iframe.setAttribute("scrolling", "no");
    this.iframe.style.pointerEvents = "none";
  }
  /**
   * Empties the replayer's cache and reclaims memory.
   * The replayer will use this cache to speed up the playback.
   */
  resetCache() {
    this.cache = createCache();
  }
  setupDom() {
    this.wrapper = document.createElement("div");
    this.wrapper.classList.add("replayer-wrapper");
    this.config.root.appendChild(this.wrapper);
    this.mouse = document.createElement("div");
    this.mouse.classList.add("replayer-mouse");
    this.wrapper.appendChild(this.mouse);
    if (this.config.mouseTail !== false) {
      this.mouseTail = document.createElement("canvas");
      this.mouseTail.classList.add("replayer-mouse-tail");
      this.mouseTail.style.display = "inherit";
      this.wrapper.appendChild(this.mouseTail);
    }
    this.iframe = document.createElement("iframe");
    const attributes = ["allow-same-origin"];
    if (this.config.UNSAFE_replayCanvas) {
      attributes.push("allow-scripts");
    }
    this.iframe.style.display = "none";
    this.iframe.setAttribute("sandbox", attributes.join(" "));
    this.disableInteract();
    this.wrapper.appendChild(this.iframe);
    if (this.iframe.contentWindow && this.iframe.contentDocument) {
      polyfill(
        this.iframe.contentWindow,
        this.iframe.contentDocument
      );
      polyfill$1(this.iframe.contentWindow);
    }
  }
  rebuildFullSnapshot(event, isSync = false) {
    if (!this.iframe.contentDocument) {
      return this.warn("Looks like your replayer has been destroyed.");
    }
    if (Object.keys(this.legacy_missingNodeRetryMap).length) {
      this.warn(
        "Found unresolved missing node map",
        this.legacy_missingNodeRetryMap
      );
    }
    this.legacy_missingNodeRetryMap = {};
    const collectedIframes = [];
    const collectedDialogs = /* @__PURE__ */ new Set();
    const afterAppend = (builtNode, id) => {
      if (builtNode.nodeName === "DIALOG")
        collectedDialogs.add(builtNode);
      this.collectIframeAndAttachDocument(collectedIframes, builtNode);
      if (this.mediaManager.isSupportedMediaElement(builtNode)) {
        const { events } = this.service.state.context;
        this.mediaManager.addMediaElements(
          builtNode,
          event.timestamp - events[0].timestamp,
          this.mirror
        );
      }
      for (const plugin3 of this.config.plugins || []) {
        if (plugin3.onBuild)
          plugin3.onBuild(builtNode, {
            id,
            replayer: this
          });
      }
    };
    if (this.usingVirtualDom) {
      this.virtualDom.destroyTree();
      this.usingVirtualDom = false;
    }
    this.mirror.reset();
    rebuild(event.data.node, {
      doc: this.iframe.contentDocument,
      afterAppend,
      cache: this.cache,
      mirror: this.mirror
    });
    afterAppend(this.iframe.contentDocument, event.data.node.id);
    for (const { mutationInQueue, builtNode } of collectedIframes) {
      this.attachDocumentToIframe(mutationInQueue, builtNode);
      this.newDocumentQueue = this.newDocumentQueue.filter(
        (m) => m !== mutationInQueue
      );
    }
    const { documentElement, head } = this.iframe.contentDocument;
    this.insertStyleRules(documentElement, head);
    collectedDialogs.forEach((d) => applyDialogToTopLevel(d));
    if (!this.service.state.matches("playing")) {
      this.iframe.contentDocument.getElementsByTagName("html")[0].classList.add("rrweb-paused");
    }
    this.emitter.emit(ReplayerEvents.FullsnapshotRebuilded, event);
    if (!isSync) {
      this.waitForStylesheetLoad();
    }
    if (this.config.UNSAFE_replayCanvas) {
      void this.preloadAllImages();
    }
  }
  insertStyleRules(documentElement, head) {
    var _a2;
    const injectStylesRules = rules(
      this.config.blockClass
    ).concat(this.config.insertStyleRules);
    if (this.config.pauseAnimation) {
      injectStylesRules.push(
        "html.rrweb-paused *, html.rrweb-paused *:before, html.rrweb-paused *:after { animation-play-state: paused !important; }"
      );
    }
    if (!injectStylesRules.length) {
      return;
    }
    if (this.usingVirtualDom) {
      const styleEl = this.virtualDom.createElement("style");
      this.virtualDom.mirror.add(
        styleEl,
        getDefaultSN(styleEl, this.virtualDom.unserializedId)
      );
      documentElement.insertBefore(styleEl, head);
      styleEl.rules.push({
        source: IncrementalSource$1.StyleSheetRule,
        adds: injectStylesRules.map((cssText, index2) => ({
          rule: cssText,
          index: index2
        }))
      });
    } else {
      const styleEl = document.createElement("style");
      documentElement.insertBefore(
        styleEl,
        head
      );
      for (let idx = 0; idx < injectStylesRules.length; idx++) {
        (_a2 = styleEl.sheet) == null ? void 0 : _a2.insertRule(injectStylesRules[idx], idx);
      }
    }
  }
  attachDocumentToIframe(mutation, iframeEl) {
    const mirror2 = this.usingVirtualDom ? this.virtualDom.mirror : this.mirror;
    const collectedIframes = [];
    const collectedDialogs = /* @__PURE__ */ new Set();
    const afterAppend = (builtNode, id) => {
      if (builtNode.nodeName === "DIALOG")
        collectedDialogs.add(builtNode);
      this.collectIframeAndAttachDocument(collectedIframes, builtNode);
      const sn = mirror2.getMeta(builtNode);
      if ((sn == null ? void 0 : sn.type) === NodeType.Element && (sn == null ? void 0 : sn.tagName.toUpperCase()) === "HTML") {
        const { documentElement, head } = iframeEl.contentDocument;
        this.insertStyleRules(
          documentElement,
          head
        );
      }
      if (this.usingVirtualDom) return;
      for (const plugin3 of this.config.plugins || []) {
        if (plugin3.onBuild)
          plugin3.onBuild(builtNode, {
            id,
            replayer: this
          });
      }
    };
    buildNodeWithSN(mutation.node, {
      doc: iframeEl.contentDocument,
      mirror: mirror2,
      hackCss: true,
      skipChild: false,
      afterAppend,
      cache: this.cache
    });
    afterAppend(iframeEl.contentDocument, mutation.node.id);
    for (const { mutationInQueue, builtNode } of collectedIframes) {
      this.attachDocumentToIframe(mutationInQueue, builtNode);
      this.newDocumentQueue = this.newDocumentQueue.filter(
        (m) => m !== mutationInQueue
      );
    }
    collectedDialogs.forEach((d) => applyDialogToTopLevel(d));
  }
  collectIframeAndAttachDocument(collected, builtNode) {
    if (isSerializedIframe(builtNode, this.mirror)) {
      const mutationInQueue = this.newDocumentQueue.find(
        (m) => m.parentId === this.mirror.getId(builtNode)
      );
      if (mutationInQueue) {
        collected.push({
          mutationInQueue,
          builtNode
        });
      }
    }
  }
  /**
   * pause when loading style sheet, resume when loaded all timeout exceed
   */
  waitForStylesheetLoad() {
    var _a2;
    const head = (_a2 = this.iframe.contentDocument) == null ? void 0 : _a2.head;
    if (head) {
      const unloadSheets = /* @__PURE__ */ new Set();
      let timer;
      let beforeLoadState = this.service.state;
      const stateHandler = () => {
        beforeLoadState = this.service.state;
      };
      this.emitter.on(ReplayerEvents.Start, stateHandler);
      this.emitter.on(ReplayerEvents.Pause, stateHandler);
      const unsubscribe = () => {
        this.emitter.off(ReplayerEvents.Start, stateHandler);
        this.emitter.off(ReplayerEvents.Pause, stateHandler);
      };
      head.querySelectorAll('link[rel="stylesheet"]').forEach((css) => {
        if (!css.sheet) {
          unloadSheets.add(css);
          css.addEventListener("load", () => {
            unloadSheets.delete(css);
            if (unloadSheets.size === 0 && timer !== -1) {
              if (beforeLoadState.matches("playing")) {
                this.play(this.getCurrentTime());
              }
              this.emitter.emit(ReplayerEvents.LoadStylesheetEnd);
              if (timer) {
                clearTimeout(timer);
              }
              unsubscribe();
            }
          });
        }
      });
      if (unloadSheets.size > 0) {
        this.service.send({ type: "PAUSE" });
        this.emitter.emit(ReplayerEvents.LoadStylesheetStart);
        timer = setTimeout(() => {
          if (beforeLoadState.matches("playing")) {
            this.play(this.getCurrentTime());
          }
          timer = -1;
          unsubscribe();
        }, this.config.loadTimeout);
      }
    }
  }
  /**
   * pause when there are some canvas drawImage args need to be loaded
   */
  async preloadAllImages() {
    const promises = [];
    for (const event of this.service.state.context.events) {
      if (event.type === EventType$1.IncrementalSnapshot && event.data.source === IncrementalSource$1.CanvasMutation) {
        promises.push(
          this.deserializeAndPreloadCanvasEvents(event.data, event)
        );
        const commands = "commands" in event.data ? event.data.commands : [event.data];
        commands.forEach((c2) => {
          this.preloadImages(c2, event);
        });
      }
    }
    return Promise.all(promises);
  }
  preloadImages(data, event) {
    if (data.property === "drawImage" && typeof data.args[0] === "string" && !this.imageMap.has(event)) {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      const imgd = ctx == null ? void 0 : ctx.createImageData(canvas.width, canvas.height);
      ctx == null ? void 0 : ctx.putImageData(imgd, 0, 0);
    }
  }
  async deserializeAndPreloadCanvasEvents(data, event) {
    if (!this.canvasEventMap.has(event)) {
      const status = {
        isUnchanged: true
      };
      if ("commands" in data) {
        const commands = await Promise.all(
          data.commands.map(async (c2) => {
            const args = await Promise.all(
              c2.args.map(deserializeArg(this.imageMap, null, status))
            );
            return __spreadProps(__spreadValues({}, c2), { args });
          })
        );
        if (status.isUnchanged === false)
          this.canvasEventMap.set(event, __spreadProps(__spreadValues({}, data), { commands }));
      } else {
        const args = await Promise.all(
          data.args.map(deserializeArg(this.imageMap, null, status))
        );
        if (status.isUnchanged === false)
          this.canvasEventMap.set(event, __spreadProps(__spreadValues({}, data), { args }));
      }
    }
  }
  applyIncremental(e2, isSync) {
    var _a2, _b2, _c;
    const { data: d } = e2;
    switch (d.source) {
      case IncrementalSource$1.Mutation: {
        try {
          this.applyMutation(d, isSync);
        } catch (error) {
          this.warn(`Exception in mutation ${error.message || error}`, d);
        }
        break;
      }
      case IncrementalSource$1.Drag:
      case IncrementalSource$1.TouchMove:
      case IncrementalSource$1.MouseMove:
        if (isSync) {
          const lastPosition = d.positions[d.positions.length - 1];
          this.mousePos = {
            x: lastPosition.x,
            y: lastPosition.y,
            id: lastPosition.id,
            debugData: d
          };
        } else {
          d.positions.forEach((p) => {
            const action = {
              doAction: () => {
                this.moveAndHover(p.x, p.y, p.id, isSync, d);
              },
              delay: p.timeOffset + e2.timestamp - this.service.state.context.baselineTime
            };
            this.timer.addAction(action);
          });
          this.timer.addAction({
            doAction() {
            },
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            delay: e2.delay - ((_a2 = d.positions[0]) == null ? void 0 : _a2.timeOffset)
          });
        }
        break;
      case IncrementalSource$1.MouseInteraction: {
        if (d.id === -1) {
          break;
        }
        const event = new Event(toLowerCase(MouseInteractions[d.type]));
        const target = this.mirror.getNode(d.id);
        if (!target) {
          return this.debugNodeNotFound(d, d.id);
        }
        this.emitter.emit(ReplayerEvents.MouseInteraction, {
          type: d.type,
          target
        });
        const { triggerFocus } = this.config;
        switch (d.type) {
          case MouseInteractions.Blur:
            if ("blur" in target) {
              target.blur();
            }
            break;
          case MouseInteractions.Focus:
            if (triggerFocus && target.focus) {
              target.focus({
                preventScroll: true
              });
            }
            break;
          case MouseInteractions.Click:
          case MouseInteractions.TouchStart:
          case MouseInteractions.TouchEnd:
          case MouseInteractions.MouseDown:
          case MouseInteractions.MouseUp:
            if (isSync) {
              if (d.type === MouseInteractions.TouchStart) {
                this.touchActive = true;
              } else if (d.type === MouseInteractions.TouchEnd) {
                this.touchActive = false;
              }
              if (d.type === MouseInteractions.MouseDown) {
                this.lastMouseDownEvent = [target, event];
              } else if (d.type === MouseInteractions.MouseUp) {
                this.lastMouseDownEvent = null;
              }
              this.mousePos = {
                x: d.x || 0,
                y: d.y || 0,
                id: d.id,
                debugData: d
              };
            } else {
              if (d.type === MouseInteractions.TouchStart) {
                this.tailPositions.length = 0;
              }
              this.moveAndHover(d.x || 0, d.y || 0, d.id, isSync, d);
              if (d.type === MouseInteractions.Click) {
                this.mouse.classList.remove("active");
                void this.mouse.offsetWidth;
                this.mouse.classList.add("active");
              } else if (d.type === MouseInteractions.TouchStart) {
                void this.mouse.offsetWidth;
                this.mouse.classList.add("touch-active");
              } else if (d.type === MouseInteractions.TouchEnd) {
                this.mouse.classList.remove("touch-active");
              } else {
                target.dispatchEvent(event);
              }
            }
            break;
          case MouseInteractions.TouchCancel:
            if (isSync) {
              this.touchActive = false;
            } else {
              this.mouse.classList.remove("touch-active");
            }
            break;
          default:
            target.dispatchEvent(event);
        }
        break;
      }
      case IncrementalSource$1.Scroll: {
        if (d.id === -1) {
          break;
        }
        if (this.usingVirtualDom) {
          const target = this.virtualDom.mirror.getNode(d.id);
          if (!target) {
            return this.debugNodeNotFound(d, d.id);
          }
          target.scrollData = d;
          break;
        }
        this.applyScroll(d, isSync);
        break;
      }
      case IncrementalSource$1.ViewportResize:
        this.emitter.emit(ReplayerEvents.Resize, {
          width: d.width,
          height: d.height
        });
        break;
      case IncrementalSource$1.Input: {
        if (d.id === -1) {
          break;
        }
        if (this.usingVirtualDom) {
          const target = this.virtualDom.mirror.getNode(d.id);
          if (!target) {
            return this.debugNodeNotFound(d, d.id);
          }
          target.inputData = d;
          break;
        }
        this.applyInput(d);
        break;
      }
      case IncrementalSource$1.MediaInteraction: {
        const target = this.usingVirtualDom ? this.virtualDom.mirror.getNode(d.id) : this.mirror.getNode(d.id);
        if (!target) {
          return this.debugNodeNotFound(d, d.id);
        }
        const mediaEl = target;
        const { events } = this.service.state.context;
        this.mediaManager.mediaMutation({
          target: mediaEl,
          timeOffset: e2.timestamp - events[0].timestamp,
          mutation: d
        });
        break;
      }
      case IncrementalSource$1.StyleSheetRule:
      case IncrementalSource$1.StyleDeclaration: {
        if (this.usingVirtualDom) {
          if (d.styleId) this.constructedStyleMutations.push(d);
          else if (d.id)
            (_b2 = this.virtualDom.mirror.getNode(d.id)) == null ? void 0 : _b2.rules.push(d);
        } else this.applyStyleSheetMutation(d);
        break;
      }
      case IncrementalSource$1.CanvasMutation: {
        if (!this.config.UNSAFE_replayCanvas) {
          return;
        }
        if (this.usingVirtualDom) {
          const target = this.virtualDom.mirror.getNode(
            d.id
          );
          if (!target) {
            return this.debugNodeNotFound(d, d.id);
          }
          target.canvasMutations.push({
            event: e2,
            mutation: d
          });
        } else {
          const target = this.mirror.getNode(d.id);
          if (!target) {
            return this.debugNodeNotFound(d, d.id);
          }
          void canvasMutation({
            event: e2,
            mutation: d,
            target,
            imageMap: this.imageMap,
            canvasEventMap: this.canvasEventMap,
            errorHandler: this.warnCanvasMutationFailed.bind(this)
          });
        }
        break;
      }
      case IncrementalSource$1.Font: {
        try {
          const fontFace = new FontFace(
            d.family,
            d.buffer ? new Uint8Array(JSON.parse(d.fontSource)) : d.fontSource,
            d.descriptors
          );
          (_c = this.iframe.contentDocument) == null ? void 0 : _c.fonts.add(fontFace);
        } catch (error) {
          this.warn(error);
        }
        break;
      }
      case IncrementalSource$1.Selection: {
        if (isSync) {
          this.lastSelectionData = d;
          break;
        }
        this.applySelection(d);
        break;
      }
      case IncrementalSource$1.AdoptedStyleSheet: {
        if (this.usingVirtualDom) this.adoptedStyleSheets.push(d);
        else this.applyAdoptedStyleSheet(d);
        break;
      }
    }
  }
  /**
   * Apply the mutation to the virtual dom or the real dom.
   * @param d - The mutation data.
   * @param isSync - Whether the mutation should be applied synchronously (while fast-forwarding).
   */
  applyMutation(d, isSync) {
    if (this.config.useVirtualDom && !this.usingVirtualDom && isSync) {
      this.usingVirtualDom = true;
      buildFromDom(this.iframe.contentDocument, this.mirror, this.virtualDom);
      if (Object.keys(this.legacy_missingNodeRetryMap).length) {
        for (const key in this.legacy_missingNodeRetryMap) {
          try {
            const value = this.legacy_missingNodeRetryMap[key];
            const virtualNode = buildFromNode(
              value.node,
              this.virtualDom,
              this.mirror
            );
            if (virtualNode) value.node = virtualNode;
          } catch (error) {
            this.warn(error);
          }
        }
      }
    }
    const mirror2 = this.usingVirtualDom ? this.virtualDom.mirror : this.mirror;
    d.removes = d.removes.filter((mutation) => {
      if (!mirror2.getNode(mutation.id)) {
        this.warnNodeNotFound(d, mutation.id);
        return false;
      }
      return true;
    });
    d.removes.forEach((mutation) => {
      var _a2;
      const target = mirror2.getNode(mutation.id);
      if (!target) {
        return;
      }
      let parent = mirror2.getNode(
        mutation.parentId
      );
      if (!parent) {
        return this.warnNodeNotFound(d, mutation.parentId);
      }
      if (mutation.isShadow && hasShadowRoot(parent)) {
        parent = parent.shadowRoot;
      }
      mirror2.removeNodeFromMap(target);
      if (parent)
        try {
          parent.removeChild(target);
          if (this.usingVirtualDom && target.nodeName === "#text" && parent.nodeName === "STYLE" && ((_a2 = parent.rules) == null ? void 0 : _a2.length) > 0)
            parent.rules = [];
        } catch (error) {
          if (error instanceof DOMException) {
            this.warn(
              "parent could not remove child in mutation",
              parent,
              target,
              d
            );
          } else {
            throw error;
          }
        }
    });
    const legacy_missingNodeMap = __spreadValues({}, this.legacy_missingNodeRetryMap);
    const queue = [];
    const nextNotInDOM = (mutation) => {
      let next = null;
      if (mutation.nextId) {
        next = mirror2.getNode(mutation.nextId);
      }
      if (mutation.nextId !== null && mutation.nextId !== void 0 && mutation.nextId !== -1 && !next) {
        return true;
      }
      return false;
    };
    const appendNode = (mutation) => {
      var _a2, _b2;
      if (!this.iframe.contentDocument) {
        return this.warn("Looks like your replayer has been destroyed.");
      }
      let parent = mirror2.getNode(
        mutation.parentId
      );
      if (!parent) {
        if (mutation.node.type === NodeType.Document) {
          return this.newDocumentQueue.push(mutation);
        }
        return queue.push(mutation);
      }
      if (mutation.node.isShadow) {
        if (!hasShadowRoot(parent)) {
          parent.attachShadow({ mode: "open" });
          parent = parent.shadowRoot;
        } else parent = parent.shadowRoot;
      }
      let previous = null;
      let next = null;
      if (mutation.previousId) {
        previous = mirror2.getNode(mutation.previousId);
      }
      if (mutation.nextId) {
        next = mirror2.getNode(mutation.nextId);
      }
      if (nextNotInDOM(mutation)) {
        return queue.push(mutation);
      }
      if (mutation.node.rootId && !mirror2.getNode(mutation.node.rootId)) {
        return;
      }
      const targetDoc = mutation.node.rootId ? mirror2.getNode(mutation.node.rootId) : this.usingVirtualDom ? this.virtualDom : this.iframe.contentDocument;
      if (isSerializedIframe(parent, mirror2)) {
        this.attachDocumentToIframe(
          mutation,
          parent
        );
        return;
      }
      const afterAppend = (node2, id) => {
        if (this.usingVirtualDom) return;
        applyDialogToTopLevel(node2);
        for (const plugin3 of this.config.plugins || []) {
          if (plugin3.onBuild) plugin3.onBuild(node2, { id, replayer: this });
        }
      };
      const target = buildNodeWithSN(mutation.node, {
        doc: targetDoc,
        // can be Document or RRDocument
        mirror: mirror2,
        // can be this.mirror or virtualDom.mirror
        skipChild: true,
        hackCss: true,
        cache: this.cache,
        /**
         * caveat: `afterAppend` only gets called on child nodes of target
         * we have to call it again below when this target was added to the DOM
         */
        afterAppend
      });
      if (mutation.previousId === -1 || mutation.nextId === -1) {
        legacy_missingNodeMap[mutation.node.id] = {
          node: target,
          mutation
        };
        return;
      }
      const parentSn = mirror2.getMeta(parent);
      if (parentSn && parentSn.type === NodeType.Element && mutation.node.type === NodeType.Text) {
        const prospectiveSiblings = Array.isArray(parent.childNodes) ? parent.childNodes : Array.from(parent.childNodes);
        if (parentSn.tagName === "textarea") {
          for (const c2 of prospectiveSiblings) {
            if (c2.nodeType === parent.TEXT_NODE) {
              parent.removeChild(c2);
            }
          }
        } else if (parentSn.tagName === "style" && prospectiveSiblings.length === 1) {
          for (const cssText of prospectiveSiblings) {
            if (cssText.nodeType === parent.TEXT_NODE && !mirror2.hasNode(cssText)) {
              target.textContent = cssText.textContent;
              parent.removeChild(cssText);
            }
          }
        }
      } else if ((parentSn == null ? void 0 : parentSn.type) === NodeType.Document) {
        const parentDoc = parent;
        if (mutation.node.type === NodeType.DocumentType && ((_a2 = parentDoc.childNodes[0]) == null ? void 0 : _a2.nodeType) === Node.DOCUMENT_TYPE_NODE)
          parentDoc.removeChild(parentDoc.childNodes[0]);
        if (target.nodeName === "HTML" && parentDoc.documentElement)
          parentDoc.removeChild(
            parentDoc.documentElement
          );
      }
      if (previous && previous.nextSibling && previous.nextSibling.parentNode) {
        parent.insertBefore(
          target,
          previous.nextSibling
        );
      } else if (next && next.parentNode) {
        parent.contains(next) ? parent.insertBefore(target, next) : parent.insertBefore(target, null);
      } else {
        parent.appendChild(target);
      }
      afterAppend(target, mutation.node.id);
      if (this.usingVirtualDom && target.nodeName === "#text" && parent.nodeName === "STYLE" && ((_b2 = parent.rules) == null ? void 0 : _b2.length) > 0)
        parent.rules = [];
      if (isSerializedIframe(target, this.mirror)) {
        const targetId = this.mirror.getId(target);
        const mutationInQueue = this.newDocumentQueue.find(
          (m) => m.parentId === targetId
        );
        if (mutationInQueue) {
          this.attachDocumentToIframe(
            mutationInQueue,
            target
          );
          this.newDocumentQueue = this.newDocumentQueue.filter(
            (m) => m !== mutationInQueue
          );
        }
      }
      if (mutation.previousId || mutation.nextId) {
        this.legacy_resolveMissingNode(
          legacy_missingNodeMap,
          parent,
          target,
          mutation
        );
      }
    };
    d.adds.forEach((mutation) => {
      appendNode(mutation);
    });
    const startTime = Date.now();
    while (queue.length) {
      const resolveTrees = queueToResolveTrees(queue);
      queue.length = 0;
      if (Date.now() - startTime > 500) {
        this.warn(
          "Timeout in the loop, please check the resolve tree data:",
          resolveTrees
        );
        break;
      }
      for (const tree of resolveTrees) {
        const parent = mirror2.getNode(tree.value.parentId);
        if (!parent) {
          this.debug(
            "Drop resolve tree since there is no parent for the root node.",
            tree
          );
        } else {
          iterateResolveTree(tree, (mutation) => {
            appendNode(mutation);
          });
        }
      }
    }
    if (Object.keys(legacy_missingNodeMap).length) {
      Object.assign(this.legacy_missingNodeRetryMap, legacy_missingNodeMap);
    }
    uniqueTextMutations(d.texts).forEach((mutation) => {
      var _a2;
      const target = mirror2.getNode(mutation.id);
      if (!target) {
        if (d.removes.find((r2) => r2.id === mutation.id)) {
          return;
        }
        return this.warnNodeNotFound(d, mutation.id);
      }
      const parentEl = target.parentElement;
      if (mutation.value && parentEl && parentEl.tagName === "STYLE") {
        target.textContent = adaptCssForReplay(mutation.value, this.cache);
      } else {
        target.textContent = mutation.value;
      }
      if (this.usingVirtualDom) {
        const parent = target.parentNode;
        if (((_a2 = parent == null ? void 0 : parent.rules) == null ? void 0 : _a2.length) > 0) parent.rules = [];
      }
    });
    d.attributes.forEach((mutation) => {
      var _a2;
      const target = mirror2.getNode(mutation.id);
      if (!target) {
        if (d.removes.find((r2) => r2.id === mutation.id)) {
          return;
        }
        return this.warnNodeNotFound(d, mutation.id);
      }
      for (const attributeName in mutation.attributes) {
        if (typeof attributeName === "string") {
          const value = mutation.attributes[attributeName];
          if (value === null) {
            target.removeAttribute(attributeName);
            if (attributeName === "open")
              removeDialogFromTopLevel(target, mutation);
          } else if (typeof value === "string") {
            try {
              if (attributeName === "_cssText" && (target.nodeName === "LINK" || target.nodeName === "STYLE")) {
                try {
                  const newSn = mirror2.getMeta(
                    target
                  );
                  const newNode = buildNodeWithSN(
                    __spreadProps(__spreadValues({}, newSn), {
                      attributes: __spreadValues(__spreadValues({}, newSn.attributes), mutation.attributes)
                    }),
                    {
                      doc: target.ownerDocument,
                      // can be Document or RRDocument
                      mirror: mirror2,
                      skipChild: true,
                      hackCss: true,
                      cache: this.cache
                    }
                  );
                  Object.assign(
                    newSn.attributes,
                    mutation.attributes
                  );
                  const siblingNode = target.nextSibling;
                  const parentNode2 = target.parentNode;
                  if (newNode && parentNode2) {
                    parentNode2.removeChild(target);
                    parentNode2.insertBefore(
                      newNode,
                      siblingNode
                    );
                    mirror2.replace(mutation.id, newNode);
                    break;
                  }
                } catch (e2) {
                }
              }
              if (attributeName === "value" && target.nodeName === "TEXTAREA") {
                const textarea = target;
                textarea.childNodes.forEach(
                  (c2) => textarea.removeChild(c2)
                );
                const tn = (_a2 = target.ownerDocument) == null ? void 0 : _a2.createTextNode(value);
                if (tn) {
                  textarea.appendChild(tn);
                }
              } else {
                target.setAttribute(
                  attributeName,
                  value
                );
              }
              if (attributeName === "rr_open_mode" && target.nodeName === "DIALOG") {
                applyDialogToTopLevel(target, mutation);
              }
            } catch (error) {
              this.warn(
                "An error occurred may due to the checkout feature.",
                error
              );
            }
          } else if (attributeName === "style") {
            const styleValues = value;
            const targetEl = target;
            for (const s2 in styleValues) {
              if (styleValues[s2] === false) {
                targetEl.style.removeProperty(s2);
              } else if (styleValues[s2] instanceof Array) {
                const svp = styleValues[s2];
                targetEl.style.setProperty(s2, svp[0], svp[1]);
              } else {
                const svs = styleValues[s2];
                targetEl.style.setProperty(s2, svs);
              }
            }
          }
        }
      }
    });
  }
  /**
   * Apply the scroll data on real elements.
   * If the replayer is in sync mode, smooth scroll behavior should be disabled.
   * @param d - the scroll data
   * @param isSync - whether the replayer is in sync mode(fast-forward)
   */
  applyScroll(d, isSync) {
    var _a2, _b2;
    const target = this.mirror.getNode(d.id);
    if (!target) {
      return this.debugNodeNotFound(d, d.id);
    }
    const sn = this.mirror.getMeta(target);
    if (target === this.iframe.contentDocument) {
      (_a2 = this.iframe.contentWindow) == null ? void 0 : _a2.scrollTo({
        top: d.y,
        left: d.x,
        behavior: isSync ? "auto" : "smooth"
      });
    } else if ((sn == null ? void 0 : sn.type) === NodeType.Document) {
      (_b2 = target.defaultView) == null ? void 0 : _b2.scrollTo({
        top: d.y,
        left: d.x,
        behavior: isSync ? "auto" : "smooth"
      });
    } else {
      try {
        target.scrollTo({
          top: d.y,
          left: d.x,
          behavior: isSync ? "auto" : "smooth"
        });
      } catch (error) {
      }
    }
  }
  applyInput(d) {
    const target = this.mirror.getNode(d.id);
    if (!target) {
      return this.debugNodeNotFound(d, d.id);
    }
    try {
      target.checked = d.isChecked;
      target.value = d.text;
    } catch (error) {
    }
  }
  applySelection(d) {
    try {
      const selectionSet = /* @__PURE__ */ new Set();
      const ranges = d.ranges.map(({ start, startOffset, end, endOffset }) => {
        const startContainer = this.mirror.getNode(start);
        const endContainer = this.mirror.getNode(end);
        if (!startContainer || !endContainer) return;
        const result2 = new Range();
        result2.setStart(startContainer, startOffset);
        result2.setEnd(endContainer, endOffset);
        const doc = startContainer.ownerDocument;
        const selection = doc == null ? void 0 : doc.getSelection();
        selection && selectionSet.add(selection);
        return {
          range: result2,
          selection
        };
      });
      selectionSet.forEach((s2) => s2.removeAllRanges());
      ranges.forEach((r2) => {
        var _a2;
        return r2 && ((_a2 = r2.selection) == null ? void 0 : _a2.addRange(r2.range));
      });
    } catch (error) {
    }
  }
  applyStyleSheetMutation(data) {
    var _a2;
    let styleSheet = null;
    if (data.styleId) styleSheet = this.styleMirror.getStyle(data.styleId);
    else if (data.id)
      styleSheet = ((_a2 = this.mirror.getNode(data.id)) == null ? void 0 : _a2.sheet) || null;
    if (!styleSheet) return;
    if (data.source === IncrementalSource$1.StyleSheetRule)
      this.applyStyleSheetRule(data, styleSheet);
    else if (data.source === IncrementalSource$1.StyleDeclaration)
      this.applyStyleDeclaration(data, styleSheet);
  }
  applyStyleSheetRule(data, styleSheet) {
    var _a2, _b2, _c, _d;
    (_a2 = data.adds) == null ? void 0 : _a2.forEach(({ rule: rule2, index: nestedIndex }) => {
      try {
        if (Array.isArray(nestedIndex)) {
          const { positions, index: index2 } = getPositionsAndIndex(nestedIndex);
          const nestedRule = getNestedRule(styleSheet.cssRules, positions);
          nestedRule.insertRule(rule2, index2);
        } else {
          const index2 = nestedIndex === void 0 ? void 0 : Math.min(nestedIndex, styleSheet.cssRules.length);
          styleSheet == null ? void 0 : styleSheet.insertRule(rule2, index2);
        }
      } catch (e2) {
      }
    });
    (_b2 = data.removes) == null ? void 0 : _b2.forEach(({ index: nestedIndex }) => {
      try {
        if (Array.isArray(nestedIndex)) {
          const { positions, index: index2 } = getPositionsAndIndex(nestedIndex);
          const nestedRule = getNestedRule(styleSheet.cssRules, positions);
          nestedRule.deleteRule(index2 || 0);
        } else {
          styleSheet == null ? void 0 : styleSheet.deleteRule(nestedIndex);
        }
      } catch (e2) {
      }
    });
    if (data.replace)
      try {
        void ((_c = styleSheet.replace) == null ? void 0 : _c.call(styleSheet, data.replace));
      } catch (e2) {
      }
    if (data.replaceSync)
      try {
        (_d = styleSheet.replaceSync) == null ? void 0 : _d.call(styleSheet, data.replaceSync);
      } catch (e2) {
      }
  }
  applyStyleDeclaration(data, styleSheet) {
    if (data.set) {
      const rule2 = getNestedRule(
        styleSheet.rules,
        data.index
      );
      rule2.style.setProperty(
        data.set.property,
        data.set.value,
        data.set.priority
      );
    }
    if (data.remove) {
      const rule2 = getNestedRule(
        styleSheet.rules,
        data.index
      );
      rule2.style.removeProperty(data.remove.property);
    }
  }
  applyAdoptedStyleSheet(data) {
    var _a2;
    const targetHost = this.mirror.getNode(data.id);
    if (!targetHost) return;
    (_a2 = data.styles) == null ? void 0 : _a2.forEach((style) => {
      var _a3;
      let newStyleSheet = null;
      let hostWindow = null;
      if (hasShadowRoot(targetHost))
        hostWindow = ((_a3 = targetHost.ownerDocument) == null ? void 0 : _a3.defaultView) || null;
      else if (targetHost.nodeName === "#document")
        hostWindow = targetHost.defaultView;
      if (!hostWindow) return;
      try {
        newStyleSheet = new hostWindow.CSSStyleSheet();
        this.styleMirror.add(newStyleSheet, style.styleId);
        this.applyStyleSheetRule(
          {
            source: IncrementalSource$1.StyleSheetRule,
            adds: style.rules
          },
          newStyleSheet
        );
      } catch (e2) {
      }
    });
    const MAX_RETRY_TIME = 10;
    let count = 0;
    const adoptStyleSheets = (targetHost2, styleIds) => {
      const stylesToAdopt = styleIds.map((styleId) => this.styleMirror.getStyle(styleId)).filter((style) => style !== null);
      if (hasShadowRoot(targetHost2))
        targetHost2.shadowRoot.adoptedStyleSheets = stylesToAdopt;
      else if (targetHost2.nodeName === "#document")
        targetHost2.adoptedStyleSheets = stylesToAdopt;
      if (stylesToAdopt.length !== styleIds.length && count < MAX_RETRY_TIME) {
        setTimeout(
          () => adoptStyleSheets(targetHost2, styleIds),
          0 + 100 * count
        );
        count++;
      }
    };
    adoptStyleSheets(targetHost, data.styleIds);
  }
  legacy_resolveMissingNode(map, parent, target, targetMutation) {
    const { previousId, nextId } = targetMutation;
    const previousInMap = previousId && map[previousId];
    const nextInMap = nextId && map[nextId];
    if (previousInMap) {
      const { node: node2, mutation } = previousInMap;
      parent.insertBefore(node2, target);
      delete map[mutation.node.id];
      delete this.legacy_missingNodeRetryMap[mutation.node.id];
      if (mutation.previousId || mutation.nextId) {
        this.legacy_resolveMissingNode(map, parent, node2, mutation);
      }
    }
    if (nextInMap) {
      const { node: node2, mutation } = nextInMap;
      parent.insertBefore(
        node2,
        target.nextSibling
      );
      delete map[mutation.node.id];
      delete this.legacy_missingNodeRetryMap[mutation.node.id];
      if (mutation.previousId || mutation.nextId) {
        this.legacy_resolveMissingNode(map, parent, node2, mutation);
      }
    }
  }
  moveAndHover(x2, y, id, isSync, debugData) {
    const target = this.mirror.getNode(id);
    if (!target) {
      return this.debugNodeNotFound(debugData, id);
    }
    const base = getBaseDimension(target, this.iframe);
    const _x = x2 * base.absoluteScale + base.x;
    const _y = y * base.absoluteScale + base.y;
    this.mouse.style.left = `${_x}px`;
    this.mouse.style.top = `${_y}px`;
    if (!isSync) {
      this.drawMouseTail({ x: _x, y: _y });
    }
    this.hoverElements(target);
  }
  drawMouseTail(position2) {
    if (!this.mouseTail) {
      return;
    }
    const { lineCap, lineWidth, strokeStyle, duration } = this.config.mouseTail === true ? defaultMouseTailConfig : Object.assign({}, defaultMouseTailConfig, this.config.mouseTail);
    const draw = () => {
      if (!this.mouseTail) {
        return;
      }
      const ctx = this.mouseTail.getContext("2d");
      if (!ctx || !this.tailPositions.length) {
        return;
      }
      ctx.clearRect(0, 0, this.mouseTail.width, this.mouseTail.height);
      ctx.beginPath();
      ctx.lineWidth = lineWidth;
      ctx.lineCap = lineCap;
      ctx.strokeStyle = strokeStyle;
      ctx.moveTo(this.tailPositions[0].x, this.tailPositions[0].y);
      this.tailPositions.forEach((p) => ctx.lineTo(p.x, p.y));
      ctx.stroke();
    };
    this.tailPositions.push(position2);
    draw();
    setTimeout(() => {
      this.tailPositions = this.tailPositions.filter((p) => p !== position2);
      draw();
    }, duration / this.speedService.state.context.timer.speed);
  }
  hoverElements(el) {
    var _a2;
    (_a2 = this.lastHoveredRootNode || this.iframe.contentDocument) == null ? void 0 : _a2.querySelectorAll(".\\:hover").forEach((hoveredEl) => {
      hoveredEl.classList.remove(":hover");
    });
    this.lastHoveredRootNode = el.getRootNode();
    let currentEl = el;
    while (currentEl) {
      if (currentEl.classList) {
        currentEl.classList.add(":hover");
      }
      currentEl = currentEl.parentElement;
    }
  }
  isUserInteraction(event) {
    if (event.type !== EventType$1.IncrementalSnapshot) {
      return false;
    }
    return event.data.source > IncrementalSource$1.Mutation && event.data.source <= IncrementalSource$1.Input;
  }
  backToNormal() {
    this.nextUserInteractionEvent = null;
    if (this.speedService.state.matches("normal")) {
      return;
    }
    this.speedService.send({ type: "BACK_TO_NORMAL" });
    this.emitter.emit(ReplayerEvents.SkipEnd, {
      speed: this.speedService.state.context.normalSpeed
    });
  }
  warnNodeNotFound(d, id) {
    this.warn(`Node with id '${id}' not found. `, d);
  }
  warnCanvasMutationFailed(d, error) {
    this.warn(`Has error on canvas update`, error, "canvas mutation:", d);
  }
  debugNodeNotFound(d, id) {
    this.debug(`Node with id '${id}' not found. `, d);
  }
  warn(...args) {
    if (!this.config.showWarning) {
      return;
    }
    this.config.logger.warn(REPLAY_CONSOLE_PREFIX, ...args);
  }
  debug(...args) {
    if (!this.config.showDebug) {
      return;
    }
    this.config.logger.log(REPLAY_CONSOLE_PREFIX, ...args);
  }
}
var u8 = Uint8Array;
var u16 = Uint16Array;
var u32 = Uint32Array;
var fleb = new u8([
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  1,
  1,
  1,
  1,
  2,
  2,
  2,
  2,
  3,
  3,
  3,
  3,
  4,
  4,
  4,
  4,
  5,
  5,
  5,
  5,
  0,
  /* unused */
  0,
  0,
  /* impossible */
  0
]);
var fdeb = new u8([
  0,
  0,
  0,
  0,
  1,
  1,
  2,
  2,
  3,
  3,
  4,
  4,
  5,
  5,
  6,
  6,
  7,
  7,
  8,
  8,
  9,
  9,
  10,
  10,
  11,
  11,
  12,
  12,
  13,
  13,
  /* unused */
  0,
  0
]);
var clim = new u8([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);
var freb = function(eb, start) {
  var b = new u16(31);
  for (var i = 0; i < 31; ++i) {
    b[i] = start += 1 << eb[i - 1];
  }
  var r2 = new u32(b[30]);
  for (var i = 1; i < 30; ++i) {
    for (var j = b[i]; j < b[i + 1]; ++j) {
      r2[j] = j - b[i] << 5 | i;
    }
  }
  return [b, r2];
};
var _a = freb(fleb, 2);
var fl = _a[0];
var revfl = _a[1];
fl[28] = 258, revfl[258] = 28;
var _b = freb(fdeb, 0);
var fd = _b[0];
var rev = new u16(32768);
for (var i = 0; i < 32768; ++i) {
  var x = (i & 43690) >>> 1 | (i & 21845) << 1;
  x = (x & 52428) >>> 2 | (x & 13107) << 2;
  x = (x & 61680) >>> 4 | (x & 3855) << 4;
  rev[i] = ((x & 65280) >>> 8 | (x & 255) << 8) >>> 1;
}
var hMap = function(cd, mb, r2) {
  var s2 = cd.length;
  var i = 0;
  var l2 = new u16(mb);
  for (; i < s2; ++i)
    ++l2[cd[i] - 1];
  var le = new u16(mb);
  for (i = 0; i < mb; ++i) {
    le[i] = le[i - 1] + l2[i - 1] << 1;
  }
  var co;
  if (r2) {
    co = new u16(1 << mb);
    var rvb = 15 - mb;
    for (i = 0; i < s2; ++i) {
      if (cd[i]) {
        var sv = i << 4 | cd[i];
        var r_1 = mb - cd[i];
        var v2 = le[cd[i] - 1]++ << r_1;
        for (var m = v2 | (1 << r_1) - 1; v2 <= m; ++v2) {
          co[rev[v2] >>> rvb] = sv;
        }
      }
    }
  } else {
    co = new u16(s2);
    for (i = 0; i < s2; ++i)
      co[i] = rev[le[cd[i] - 1]++] >>> 15 - cd[i];
  }
  return co;
};
var flt = new u8(288);
for (var i = 0; i < 144; ++i)
  flt[i] = 8;
for (var i = 144; i < 256; ++i)
  flt[i] = 9;
for (var i = 256; i < 280; ++i)
  flt[i] = 7;
for (var i = 280; i < 288; ++i)
  flt[i] = 8;
var fdt = new u8(32);
for (var i = 0; i < 32; ++i)
  fdt[i] = 5;
var flrm = /* @__PURE__ */ hMap(flt, 9, 1);
var fdrm = /* @__PURE__ */ hMap(fdt, 5, 1);
var max = function(a2) {
  var m = a2[0];
  for (var i = 1; i < a2.length; ++i) {
    if (a2[i] > m)
      m = a2[i];
  }
  return m;
};
var bits = function(d, p, m) {
  var o2 = p / 8 >> 0;
  return (d[o2] | d[o2 + 1] << 8) >>> (p & 7) & m;
};
var bits16 = function(d, p) {
  var o2 = p / 8 >> 0;
  return (d[o2] | d[o2 + 1] << 8 | d[o2 + 2] << 16) >>> (p & 7);
};
var shft = function(p) {
  return (p / 8 >> 0) + (p & 7 && 1);
};
var slc = function(v2, s2, e2) {
  if (e2 == null || e2 > v2.length)
    e2 = v2.length;
  var n2 = new (v2 instanceof u16 ? u16 : v2 instanceof u32 ? u32 : u8)(e2 - s2);
  n2.set(v2.subarray(s2, e2));
  return n2;
};
var inflt = function(dat, buf, st) {
  var sl = dat.length;
  var noBuf = !buf || st;
  var noSt = !st || st.i;
  if (!st)
    st = {};
  if (!buf)
    buf = new u8(sl * 3);
  var cbuf = function(l22) {
    var bl = buf.length;
    if (l22 > bl) {
      var nbuf = new u8(Math.max(bl * 2, l22));
      nbuf.set(buf);
      buf = nbuf;
    }
  };
  var final = st.f || 0, pos = st.p || 0, bt = st.b || 0, lm = st.l, dm = st.d, lbt = st.m, dbt = st.n;
  var tbts = sl * 8;
  do {
    if (!lm) {
      st.f = final = bits(dat, pos, 1);
      var type = bits(dat, pos + 1, 3);
      pos += 3;
      if (!type) {
        var s2 = shft(pos) + 4, l2 = dat[s2 - 4] | dat[s2 - 3] << 8, t2 = s2 + l2;
        if (t2 > sl) {
          if (noSt)
            throw "unexpected EOF";
          break;
        }
        if (noBuf)
          cbuf(bt + l2);
        buf.set(dat.subarray(s2, t2), bt);
        st.b = bt += l2, st.p = pos = t2 * 8;
        continue;
      } else if (type == 1)
        lm = flrm, dm = fdrm, lbt = 9, dbt = 5;
      else if (type == 2) {
        var hLit = bits(dat, pos, 31) + 257, hcLen = bits(dat, pos + 10, 15) + 4;
        var tl = hLit + bits(dat, pos + 5, 31) + 1;
        pos += 14;
        var ldt = new u8(tl);
        var clt = new u8(19);
        for (var i = 0; i < hcLen; ++i) {
          clt[clim[i]] = bits(dat, pos + i * 3, 7);
        }
        pos += hcLen * 3;
        var clb = max(clt), clbmsk = (1 << clb) - 1;
        if (!noSt && pos + tl * (clb + 7) > tbts)
          break;
        var clm = hMap(clt, clb, 1);
        for (var i = 0; i < tl; ) {
          var r2 = clm[bits(dat, pos, clbmsk)];
          pos += r2 & 15;
          var s2 = r2 >>> 4;
          if (s2 < 16) {
            ldt[i++] = s2;
          } else {
            var c2 = 0, n2 = 0;
            if (s2 == 16)
              n2 = 3 + bits(dat, pos, 3), pos += 2, c2 = ldt[i - 1];
            else if (s2 == 17)
              n2 = 3 + bits(dat, pos, 7), pos += 3;
            else if (s2 == 18)
              n2 = 11 + bits(dat, pos, 127), pos += 7;
            while (n2--)
              ldt[i++] = c2;
          }
        }
        var lt = ldt.subarray(0, hLit), dt = ldt.subarray(hLit);
        lbt = max(lt);
        dbt = max(dt);
        lm = hMap(lt, lbt, 1);
        dm = hMap(dt, dbt, 1);
      } else
        throw "invalid block type";
      if (pos > tbts)
        throw "unexpected EOF";
    }
    if (noBuf)
      cbuf(bt + 131072);
    var lms = (1 << lbt) - 1, dms = (1 << dbt) - 1;
    var mxa = lbt + dbt + 18;
    while (noSt || pos + mxa < tbts) {
      var c2 = lm[bits16(dat, pos) & lms], sym = c2 >>> 4;
      pos += c2 & 15;
      if (pos > tbts)
        throw "unexpected EOF";
      if (!c2)
        throw "invalid length/literal";
      if (sym < 256)
        buf[bt++] = sym;
      else if (sym == 256) {
        lm = null;
        break;
      } else {
        var add = sym - 254;
        if (sym > 264) {
          var i = sym - 257, b = fleb[i];
          add = bits(dat, pos, (1 << b) - 1) + fl[i];
          pos += b;
        }
        var d = dm[bits16(dat, pos) & dms], dsym = d >>> 4;
        if (!d)
          throw "invalid distance";
        pos += d & 15;
        var dt = fd[dsym];
        if (dsym > 3) {
          var b = fdeb[dsym];
          dt += bits16(dat, pos) & (1 << b) - 1, pos += b;
        }
        if (pos > tbts)
          throw "unexpected EOF";
        if (noBuf)
          cbuf(bt + 131072);
        var end = bt + add;
        for (; bt < end; bt += 4) {
          buf[bt] = buf[bt - dt];
          buf[bt + 1] = buf[bt + 1 - dt];
          buf[bt + 2] = buf[bt + 2 - dt];
          buf[bt + 3] = buf[bt + 3 - dt];
        }
        bt = end;
      }
    }
    st.l = lm, st.p = pos, st.b = bt;
    if (lm)
      final = 1, st.m = lbt, st.d = dm, st.n = dbt;
  } while (!final);
  return bt == buf.length ? buf : slc(buf, 0, bt);
};
var zlv = function(d) {
  if ((d[0] & 15) != 8 || d[0] >>> 4 > 7 || (d[0] << 8 | d[1]) % 31)
    throw "invalid zlib data";
  if (d[1] & 32)
    throw "invalid zlib data: preset dictionaries not supported";
};
function unzlibSync(data, out) {
  return inflt((zlv(data), data.subarray(2, -4)), out);
}
function strToU8(str, latin1) {
  var l2 = str.length;
  var ar = new u8(str.length + (str.length >>> 1));
  var ai = 0;
  var w = function(v2) {
    ar[ai++] = v2;
  };
  for (var i = 0; i < l2; ++i) {
    if (ai + 5 > ar.length) {
      var n2 = new u8(ai + 8 + (l2 - i << 1));
      n2.set(ar);
      ar = n2;
    }
    var c2 = str.charCodeAt(i);
    if (c2 < 128 || latin1)
      w(c2);
    else if (c2 < 2048)
      w(192 | c2 >>> 6), w(128 | c2 & 63);
    else if (c2 > 55295 && c2 < 57344)
      c2 = 65536 + (c2 & 1023 << 10) | str.charCodeAt(++i) & 1023, w(240 | c2 >>> 18), w(128 | c2 >>> 12 & 63), w(128 | c2 >>> 6 & 63), w(128 | c2 & 63);
    else
      w(224 | c2 >>> 12), w(128 | c2 >>> 6 & 63), w(128 | c2 & 63);
  }
  return slc(ar, 0, ai);
}
function strFromU8(dat, latin1) {
  var r2 = "";
  if (typeof TextDecoder != "undefined")
    return new TextDecoder().decode(dat);
  for (var i = 0; i < dat.length; ) {
    var c2 = dat[i++];
    if (c2 < 128 || latin1)
      r2 += String.fromCharCode(c2);
    else if (c2 < 224)
      r2 += String.fromCharCode((c2 & 31) << 6 | dat[i++] & 63);
    else if (c2 < 240)
      r2 += String.fromCharCode((c2 & 15) << 12 | (dat[i++] & 63) << 6 | dat[i++] & 63);
    else
      c2 = ((c2 & 15) << 18 | (dat[i++] & 63) << 12 | (dat[i++] & 63) << 6 | dat[i++] & 63) - 65536, r2 += String.fromCharCode(55296 | c2 >> 10, 56320 | c2 & 1023);
  }
  return r2;
}
const MARK = "v1";
const unpack = (raw) => {
  if (typeof raw !== "string") {
    return raw;
  }
  try {
    const e2 = JSON.parse(raw);
    if (e2.timestamp) {
      return e2;
    }
  } catch (error) {
  }
  try {
    const e2 = JSON.parse(
      strFromU8(unzlibSync(strToU8(raw, true)))
    );
    if (e2.v === MARK) {
      return e2;
    }
    throw new Error(
      `These events were packed with packer ${e2.v} which is incompatible with current packer ${MARK}.`
    );
  } catch (error) {
    console.error(error);
    throw new Error("Unknown data format.");
  }
};
var EventType = /* @__PURE__ */ ((EventType2) => {
  EventType2[EventType2["DomContentLoaded"] = 0] = "DomContentLoaded";
  EventType2[EventType2["Load"] = 1] = "Load";
  EventType2[EventType2["FullSnapshot"] = 2] = "FullSnapshot";
  EventType2[EventType2["IncrementalSnapshot"] = 3] = "IncrementalSnapshot";
  EventType2[EventType2["Meta"] = 4] = "Meta";
  EventType2[EventType2["Custom"] = 5] = "Custom";
  EventType2[EventType2["Plugin"] = 6] = "Plugin";
  return EventType2;
})(EventType || {});
var IncrementalSource = /* @__PURE__ */ ((IncrementalSource2) => {
  IncrementalSource2[IncrementalSource2["Mutation"] = 0] = "Mutation";
  IncrementalSource2[IncrementalSource2["MouseMove"] = 1] = "MouseMove";
  IncrementalSource2[IncrementalSource2["MouseInteraction"] = 2] = "MouseInteraction";
  IncrementalSource2[IncrementalSource2["Scroll"] = 3] = "Scroll";
  IncrementalSource2[IncrementalSource2["ViewportResize"] = 4] = "ViewportResize";
  IncrementalSource2[IncrementalSource2["Input"] = 5] = "Input";
  IncrementalSource2[IncrementalSource2["TouchMove"] = 6] = "TouchMove";
  IncrementalSource2[IncrementalSource2["MediaInteraction"] = 7] = "MediaInteraction";
  IncrementalSource2[IncrementalSource2["StyleSheetRule"] = 8] = "StyleSheetRule";
  IncrementalSource2[IncrementalSource2["CanvasMutation"] = 9] = "CanvasMutation";
  IncrementalSource2[IncrementalSource2["Font"] = 10] = "Font";
  IncrementalSource2[IncrementalSource2["Log"] = 11] = "Log";
  IncrementalSource2[IncrementalSource2["Drag"] = 12] = "Drag";
  IncrementalSource2[IncrementalSource2["StyleDeclaration"] = 13] = "StyleDeclaration";
  IncrementalSource2[IncrementalSource2["Selection"] = 14] = "Selection";
  IncrementalSource2[IncrementalSource2["AdoptedStyleSheet"] = 15] = "AdoptedStyleSheet";
  IncrementalSource2[IncrementalSource2["CustomElement"] = 16] = "CustomElement";
  return IncrementalSource2;
})(IncrementalSource || {});
function inlineCss(cssObj) {
  let style = "";
  Object.keys(cssObj).forEach((key) => {
    style += `${key}: ${cssObj[key]};`;
  });
  return style;
}
function padZero(num, len = 2) {
  let str = String(num);
  const threshold = Math.pow(10, len - 1);
  if (num < threshold) {
    while (String(threshold).length > str.length) {
      str = `0${num}`;
    }
  }
  return str;
}
const SECOND = 1e3;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
function formatTime(ms) {
  if (ms <= 0) {
    return "00:00";
  }
  const hour = Math.floor(ms / HOUR);
  ms = ms % HOUR;
  const minute = Math.floor(ms / MINUTE);
  ms = ms % MINUTE;
  const second = Math.floor(ms / SECOND);
  if (hour) {
    return `${padZero(hour)}:${padZero(minute)}:${padZero(second)}`;
  }
  return `${padZero(minute)}:${padZero(second)}`;
}
function openFullscreen(el) {
  if (el.requestFullscreen) {
    return el.requestFullscreen();
  } else if (el.mozRequestFullScreen) {
    return el.mozRequestFullScreen();
  } else if (el.webkitRequestFullscreen) {
    return el.webkitRequestFullscreen();
  } else if (el.msRequestFullscreen) {
    return el.msRequestFullscreen();
  }
  return Promise.resolve();
}
function exitFullscreen() {
  if (document.exitFullscreen) {
    return document.exitFullscreen();
  } else if (document.mozExitFullscreen) {
    return document.mozExitFullscreen();
  } else if (document.webkitExitFullscreen) {
    return document.webkitExitFullscreen();
  } else if (document.msExitFullscreen) {
    return document.msExitFullscreen();
  }
  return Promise.resolve();
}
function isFullscreen() {
  let fullscreen = false;
  [
    "fullscreen",
    "webkitIsFullScreen",
    "mozFullScreen",
    "msFullscreenElement"
  ].forEach((fullScreenAccessor) => {
    if (fullScreenAccessor in document) {
      fullscreen = fullscreen || Boolean(document[fullScreenAccessor]);
    }
  });
  return fullscreen;
}
function onFullscreenChange(handler) {
  document.addEventListener("fullscreenchange", handler);
  document.addEventListener("webkitfullscreenchange", handler);
  document.addEventListener("mozfullscreenchange", handler);
  document.addEventListener("MSFullscreenChange", handler);
  return () => {
    document.removeEventListener("fullscreenchange", handler);
    document.removeEventListener("webkitfullscreenchange", handler);
    document.removeEventListener("mozfullscreenchange", handler);
    document.removeEventListener("MSFullscreenChange", handler);
  };
}
function typeOf(obj) {
  const toString = Object.prototype.toString;
  const map = {
    "[object Boolean]": "boolean",
    "[object Number]": "number",
    "[object String]": "string",
    "[object Function]": "function",
    "[object Array]": "array",
    "[object Date]": "date",
    "[object RegExp]": "regExp",
    "[object Undefined]": "undefined",
    "[object Null]": "null",
    "[object Object]": "object"
  };
  return map[toString.call(obj)];
}
function isUserInteraction(event) {
  if (event.type !== EventType.IncrementalSnapshot) {
    return false;
  }
  return event.data.source > IncrementalSource.Mutation && event.data.source <= IncrementalSource.Input;
}
function getInactivePeriods(events, inactivePeriodThreshold) {
  const inactivePeriods = [];
  let lastActiveTime = events[0].timestamp;
  for (const event of events) {
    if (!isUserInteraction(event)) continue;
    if (event.timestamp - lastActiveTime > inactivePeriodThreshold) {
      inactivePeriods.push([lastActiveTime, event.timestamp]);
    }
    lastActiveTime = event.timestamp;
  }
  return inactivePeriods;
}
function create_fragment$2(ctx) {
  let div;
  let input2;
  let t0;
  let label_1;
  let t1;
  let span;
  let t2;
  let mounted;
  let dispose;
  return {
    c() {
      div = element("div");
      input2 = element("input");
      t0 = space();
      label_1 = element("label");
      t1 = space();
      span = element("span");
      t2 = text(
        /*label*/
        ctx[3]
      );
      attr(input2, "type", "checkbox");
      attr(
        input2,
        "id",
        /*id*/
        ctx[2]
      );
      input2.disabled = /*disabled*/
      ctx[1];
      attr(input2, "class", "svelte-a6h7w7");
      attr(
        label_1,
        "for",
        /*id*/
        ctx[2]
      );
      attr(label_1, "class", "svelte-a6h7w7");
      attr(span, "class", "label svelte-a6h7w7");
      attr(div, "class", "switch svelte-a6h7w7");
      toggle_class(
        div,
        "disabled",
        /*disabled*/
        ctx[1]
      );
    },
    m(target, anchor) {
      insert(target, div, anchor);
      append(div, input2);
      input2.checked = /*checked*/
      ctx[0];
      append(div, t0);
      append(div, label_1);
      append(div, t1);
      append(div, span);
      append(span, t2);
      if (!mounted) {
        dispose = listen(
          input2,
          "change",
          /*input_change_handler*/
          ctx[4]
        );
        mounted = true;
      }
    },
    p(ctx2, [dirty]) {
      if (dirty & /*id*/
      4) {
        attr(
          input2,
          "id",
          /*id*/
          ctx2[2]
        );
      }
      if (dirty & /*disabled*/
      2) {
        input2.disabled = /*disabled*/
        ctx2[1];
      }
      if (dirty & /*checked*/
      1) {
        input2.checked = /*checked*/
        ctx2[0];
      }
      if (dirty & /*id*/
      4) {
        attr(
          label_1,
          "for",
          /*id*/
          ctx2[2]
        );
      }
      if (dirty & /*label*/
      8) set_data(
        t2,
        /*label*/
        ctx2[3]
      );
      if (dirty & /*disabled*/
      2) {
        toggle_class(
          div,
          "disabled",
          /*disabled*/
          ctx2[1]
        );
      }
    },
    i: noop,
    o: noop,
    d(detaching) {
      if (detaching) {
        detach(div);
      }
      mounted = false;
      dispose();
    }
  };
}
function instance$2($$self, $$props, $$invalidate) {
  let { disabled } = $$props;
  let { checked } = $$props;
  let { id } = $$props;
  let { label } = $$props;
  function input_change_handler() {
    checked = this.checked;
    $$invalidate(0, checked);
  }
  $$self.$$set = ($$props2) => {
    if ("disabled" in $$props2) $$invalidate(1, disabled = $$props2.disabled);
    if ("checked" in $$props2) $$invalidate(0, checked = $$props2.checked);
    if ("id" in $$props2) $$invalidate(2, id = $$props2.id);
    if ("label" in $$props2) $$invalidate(3, label = $$props2.label);
  };
  return [checked, disabled, id, label, input_change_handler];
}
class Switch extends SvelteComponent {
  constructor(options) {
    super();
    init(this, options, instance$2, create_fragment$2, safe_not_equal, { disabled: 1, checked: 0, id: 2, label: 3 });
  }
}
function get_each_context(ctx, list2, i) {
  const child_ctx = ctx.slice();
  child_ctx[38] = list2[i];
  return child_ctx;
}
function get_each_context_1(ctx, list2, i) {
  const child_ctx = ctx.slice();
  child_ctx[41] = list2[i];
  return child_ctx;
}
function get_each_context_2(ctx, list2, i) {
  const child_ctx = ctx.slice();
  child_ctx[44] = list2[i];
  return child_ctx;
}
function create_if_block$1(ctx) {
  let div5;
  let div3;
  let span0;
  let t0_value = formatTime(
    /*currentTime*/
    ctx[6]
  ) + "";
  let t0;
  let t1;
  let div2;
  let div0;
  let t2;
  let t3;
  let t4;
  let div1;
  let t5;
  let span1;
  let t6_value = formatTime(
    /*meta*/
    ctx[8].totalTime
  ) + "";
  let t6;
  let t7;
  let div4;
  let button0;
  let t8;
  let t9;
  let switch_1;
  let updating_checked;
  let t10;
  let button1;
  let current;
  let mounted;
  let dispose;
  let each_value_2 = ensure_array_like(
    /*inactivePeriods*/
    ctx[13]
  );
  let each_blocks_2 = [];
  for (let i = 0; i < each_value_2.length; i += 1) {
    each_blocks_2[i] = create_each_block_2(get_each_context_2(ctx, each_value_2, i));
  }
  let each_value_1 = ensure_array_like(
    /*customEvents*/
    ctx[9]
  );
  let each_blocks_1 = [];
  for (let i = 0; i < each_value_1.length; i += 1) {
    each_blocks_1[i] = create_each_block_1(get_each_context_1(ctx, each_value_1, i));
  }
  function select_block_type(ctx2, dirty) {
    if (
      /*playerState*/
      ctx2[7] === "playing"
    ) return create_if_block_1;
    return create_else_block;
  }
  let current_block_type = select_block_type(ctx);
  let if_block = current_block_type(ctx);
  let each_value = ensure_array_like(
    /*speedOption*/
    ctx[3]
  );
  let each_blocks = [];
  for (let i = 0; i < each_value.length; i += 1) {
    each_blocks[i] = create_each_block(get_each_context(ctx, each_value, i));
  }
  function switch_1_checked_binding(value) {
    ctx[29](value);
  }
  let switch_1_props = {
    id: "skip",
    disabled: (
      /*speedState*/
      ctx[10] === "skipping"
    ),
    label: "skip inactive"
  };
  if (
    /*skipInactive*/
    ctx[0] !== void 0
  ) {
    switch_1_props.checked = /*skipInactive*/
    ctx[0];
  }
  switch_1 = new Switch({ props: switch_1_props });
  binding_callbacks.push(() => bind(switch_1, "checked", switch_1_checked_binding));
  return {
    c() {
      div5 = element("div");
      div3 = element("div");
      span0 = element("span");
      t0 = text(t0_value);
      t1 = space();
      div2 = element("div");
      div0 = element("div");
      t2 = space();
      for (let i = 0; i < each_blocks_2.length; i += 1) {
        each_blocks_2[i].c();
      }
      t3 = space();
      for (let i = 0; i < each_blocks_1.length; i += 1) {
        each_blocks_1[i].c();
      }
      t4 = space();
      div1 = element("div");
      t5 = space();
      span1 = element("span");
      t6 = text(t6_value);
      t7 = space();
      div4 = element("div");
      button0 = element("button");
      if_block.c();
      t8 = space();
      for (let i = 0; i < each_blocks.length; i += 1) {
        each_blocks[i].c();
      }
      t9 = space();
      create_component(switch_1.$$.fragment);
      t10 = space();
      button1 = element("button");
      button1.innerHTML = `<svg class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="16" height="16"><defs><style type="text/css"></style></defs><path d="M916 380c-26.4 0-48-21.6-48-48L868 223.2 613.6 477.6c-18.4
            18.4-48.8 18.4-68 0-18.4-18.4-18.4-48.8 0-68L800 156 692 156c-26.4
            0-48-21.6-48-48 0-26.4 21.6-48 48-48l224 0c26.4 0 48 21.6 48 48l0
            224C964 358.4 942.4 380 916 380zM231.2 860l108.8 0c26.4 0 48 21.6 48
            48s-21.6 48-48 48l-224 0c-26.4 0-48-21.6-48-48l0-224c0-26.4 21.6-48
            48-48 26.4 0 48 21.6 48 48L164 792l253.6-253.6c18.4-18.4 48.8-18.4
            68 0 18.4 18.4 18.4 48.8 0 68L231.2 860z"></path></svg>`;
      attr(span0, "class", "rr-timeline__time svelte-189zk2r");
      attr(div0, "class", "rr-progress__step svelte-189zk2r");
      set_style(
        div0,
        "width",
        /*percentage*/
        ctx[12]
      );
      attr(div1, "class", "rr-progress__handler svelte-189zk2r");
      set_style(
        div1,
        "left",
        /*percentage*/
        ctx[12]
      );
      attr(div2, "class", "rr-progress svelte-189zk2r");
      toggle_class(
        div2,
        "disabled",
        /*speedState*/
        ctx[10] === "skipping"
      );
      attr(span1, "class", "rr-timeline__time svelte-189zk2r");
      attr(div3, "class", "rr-timeline svelte-189zk2r");
      attr(button0, "class", "svelte-189zk2r");
      attr(button1, "class", "svelte-189zk2r");
      attr(div4, "class", "rr-controller__btns svelte-189zk2r");
      attr(div5, "class", "rr-controller svelte-189zk2r");
    },
    m(target, anchor) {
      insert(target, div5, anchor);
      append(div5, div3);
      append(div3, span0);
      append(span0, t0);
      append(div3, t1);
      append(div3, div2);
      append(div2, div0);
      append(div2, t2);
      for (let i = 0; i < each_blocks_2.length; i += 1) {
        if (each_blocks_2[i]) {
          each_blocks_2[i].m(div2, null);
        }
      }
      append(div2, t3);
      for (let i = 0; i < each_blocks_1.length; i += 1) {
        if (each_blocks_1[i]) {
          each_blocks_1[i].m(div2, null);
        }
      }
      append(div2, t4);
      append(div2, div1);
      ctx[27](div2);
      append(div3, t5);
      append(div3, span1);
      append(span1, t6);
      append(div5, t7);
      append(div5, div4);
      append(div4, button0);
      if_block.m(button0, null);
      append(div4, t8);
      for (let i = 0; i < each_blocks.length; i += 1) {
        if (each_blocks[i]) {
          each_blocks[i].m(div4, null);
        }
      }
      append(div4, t9);
      mount_component(switch_1, div4, null);
      append(div4, t10);
      append(div4, button1);
      current = true;
      if (!mounted) {
        dispose = [
          listen(
            div2,
            "click",
            /*handleProgressClick*/
            ctx[15]
          ),
          listen(
            div2,
            "keydown",
            /*handleProgressKeydown*/
            ctx[16]
          ),
          listen(
            button0,
            "click",
            /*toggle*/
            ctx[4]
          ),
          listen(
            button1,
            "click",
            /*click_handler_1*/
            ctx[30]
          )
        ];
        mounted = true;
      }
    },
    p(ctx2, dirty) {
      if ((!current || dirty[0] & /*currentTime*/
      64) && t0_value !== (t0_value = formatTime(
        /*currentTime*/
        ctx2[6]
      ) + "")) set_data(t0, t0_value);
      if (!current || dirty[0] & /*percentage*/
      4096) {
        set_style(
          div0,
          "width",
          /*percentage*/
          ctx2[12]
        );
      }
      if (dirty[0] & /*inactivePeriods*/
      8192) {
        each_value_2 = ensure_array_like(
          /*inactivePeriods*/
          ctx2[13]
        );
        let i;
        for (i = 0; i < each_value_2.length; i += 1) {
          const child_ctx = get_each_context_2(ctx2, each_value_2, i);
          if (each_blocks_2[i]) {
            each_blocks_2[i].p(child_ctx, dirty);
          } else {
            each_blocks_2[i] = create_each_block_2(child_ctx);
            each_blocks_2[i].c();
            each_blocks_2[i].m(div2, t3);
          }
        }
        for (; i < each_blocks_2.length; i += 1) {
          each_blocks_2[i].d(1);
        }
        each_blocks_2.length = each_value_2.length;
      }
      if (dirty[0] & /*customEvents*/
      512) {
        each_value_1 = ensure_array_like(
          /*customEvents*/
          ctx2[9]
        );
        let i;
        for (i = 0; i < each_value_1.length; i += 1) {
          const child_ctx = get_each_context_1(ctx2, each_value_1, i);
          if (each_blocks_1[i]) {
            each_blocks_1[i].p(child_ctx, dirty);
          } else {
            each_blocks_1[i] = create_each_block_1(child_ctx);
            each_blocks_1[i].c();
            each_blocks_1[i].m(div2, t4);
          }
        }
        for (; i < each_blocks_1.length; i += 1) {
          each_blocks_1[i].d(1);
        }
        each_blocks_1.length = each_value_1.length;
      }
      if (!current || dirty[0] & /*percentage*/
      4096) {
        set_style(
          div1,
          "left",
          /*percentage*/
          ctx2[12]
        );
      }
      if (!current || dirty[0] & /*speedState*/
      1024) {
        toggle_class(
          div2,
          "disabled",
          /*speedState*/
          ctx2[10] === "skipping"
        );
      }
      if ((!current || dirty[0] & /*meta*/
      256) && t6_value !== (t6_value = formatTime(
        /*meta*/
        ctx2[8].totalTime
      ) + "")) set_data(t6, t6_value);
      if (current_block_type !== (current_block_type = select_block_type(ctx2))) {
        if_block.d(1);
        if_block = current_block_type(ctx2);
        if (if_block) {
          if_block.c();
          if_block.m(button0, null);
        }
      }
      if (dirty[0] & /*speedState, speedOption, speed, setSpeed*/
      1066) {
        each_value = ensure_array_like(
          /*speedOption*/
          ctx2[3]
        );
        let i;
        for (i = 0; i < each_value.length; i += 1) {
          const child_ctx = get_each_context(ctx2, each_value, i);
          if (each_blocks[i]) {
            each_blocks[i].p(child_ctx, dirty);
          } else {
            each_blocks[i] = create_each_block(child_ctx);
            each_blocks[i].c();
            each_blocks[i].m(div4, t9);
          }
        }
        for (; i < each_blocks.length; i += 1) {
          each_blocks[i].d(1);
        }
        each_blocks.length = each_value.length;
      }
      const switch_1_changes = {};
      if (dirty[0] & /*speedState*/
      1024) switch_1_changes.disabled = /*speedState*/
      ctx2[10] === "skipping";
      if (!updating_checked && dirty[0] & /*skipInactive*/
      1) {
        updating_checked = true;
        switch_1_changes.checked = /*skipInactive*/
        ctx2[0];
        add_flush_callback(() => updating_checked = false);
      }
      switch_1.$set(switch_1_changes);
    },
    i(local) {
      if (current) return;
      transition_in(switch_1.$$.fragment, local);
      current = true;
    },
    o(local) {
      transition_out(switch_1.$$.fragment, local);
      current = false;
    },
    d(detaching) {
      if (detaching) {
        detach(div5);
      }
      destroy_each(each_blocks_2, detaching);
      destroy_each(each_blocks_1, detaching);
      ctx[27](null);
      if_block.d();
      destroy_each(each_blocks, detaching);
      destroy_component(switch_1);
      mounted = false;
      run_all(dispose);
    }
  };
}
function create_each_block_2(ctx) {
  let div;
  let div_title_value;
  return {
    c() {
      div = element("div");
      attr(div, "title", div_title_value = /*period*/
      ctx[44].name);
      set_style(
        div,
        "width",
        /*period*/
        ctx[44].width
      );
      set_style(div, "height", "4px");
      set_style(div, "position", "absolute");
      set_style(
        div,
        "background",
        /*period*/
        ctx[44].background
      );
      set_style(
        div,
        "left",
        /*period*/
        ctx[44].position
      );
    },
    m(target, anchor) {
      insert(target, div, anchor);
    },
    p(ctx2, dirty) {
      if (dirty[0] & /*inactivePeriods*/
      8192 && div_title_value !== (div_title_value = /*period*/
      ctx2[44].name)) {
        attr(div, "title", div_title_value);
      }
      if (dirty[0] & /*inactivePeriods*/
      8192) {
        set_style(
          div,
          "width",
          /*period*/
          ctx2[44].width
        );
      }
      if (dirty[0] & /*inactivePeriods*/
      8192) {
        set_style(
          div,
          "background",
          /*period*/
          ctx2[44].background
        );
      }
      if (dirty[0] & /*inactivePeriods*/
      8192) {
        set_style(
          div,
          "left",
          /*period*/
          ctx2[44].position
        );
      }
    },
    d(detaching) {
      if (detaching) {
        detach(div);
      }
    }
  };
}
function create_each_block_1(ctx) {
  let div;
  let div_title_value;
  return {
    c() {
      div = element("div");
      attr(div, "title", div_title_value = /*event*/
      ctx[41].name);
      set_style(div, "width", "10px");
      set_style(div, "height", "5px");
      set_style(div, "position", "absolute");
      set_style(div, "top", "2px");
      set_style(div, "transform", "translate(-50%, -50%)");
      set_style(
        div,
        "background",
        /*event*/
        ctx[41].background
      );
      set_style(
        div,
        "left",
        /*event*/
        ctx[41].position
      );
    },
    m(target, anchor) {
      insert(target, div, anchor);
    },
    p(ctx2, dirty) {
      if (dirty[0] & /*customEvents*/
      512 && div_title_value !== (div_title_value = /*event*/
      ctx2[41].name)) {
        attr(div, "title", div_title_value);
      }
      if (dirty[0] & /*customEvents*/
      512) {
        set_style(
          div,
          "background",
          /*event*/
          ctx2[41].background
        );
      }
      if (dirty[0] & /*customEvents*/
      512) {
        set_style(
          div,
          "left",
          /*event*/
          ctx2[41].position
        );
      }
    },
    d(detaching) {
      if (detaching) {
        detach(div);
      }
    }
  };
}
function create_else_block(ctx) {
  let svg;
  let path;
  return {
    c() {
      svg = svg_element("svg");
      path = svg_element("path");
      attr(path, "d", "M170.65984 896l0-768 640 384zM644.66944\n              512l-388.66944-233.32864 0 466.65728z");
      attr(svg, "class", "icon");
      attr(svg, "viewBox", "0 0 1024 1024");
      attr(svg, "version", "1.1");
      attr(svg, "xmlns", "http://www.w3.org/2000/svg");
      attr(svg, "xmlns:xlink", "http://www.w3.org/1999/xlink");
      attr(svg, "width", "16");
      attr(svg, "height", "16");
    },
    m(target, anchor) {
      insert(target, svg, anchor);
      append(svg, path);
    },
    d(detaching) {
      if (detaching) {
        detach(svg);
      }
    }
  };
}
function create_if_block_1(ctx) {
  let svg;
  let path;
  return {
    c() {
      svg = svg_element("svg");
      path = svg_element("path");
      attr(path, "d", "M682.65984 128q53.00224 0 90.50112 37.49888t37.49888 90.50112l0\n              512q0 53.00224-37.49888 90.50112t-90.50112\n              37.49888-90.50112-37.49888-37.49888-90.50112l0-512q0-53.00224\n              37.49888-90.50112t90.50112-37.49888zM341.34016 128q53.00224 0\n              90.50112 37.49888t37.49888 90.50112l0 512q0 53.00224-37.49888\n              90.50112t-90.50112\n              37.49888-90.50112-37.49888-37.49888-90.50112l0-512q0-53.00224\n              37.49888-90.50112t90.50112-37.49888zM341.34016 213.34016q-17.67424\n              0-30.16704 12.4928t-12.4928 30.16704l0 512q0 17.67424 12.4928\n              30.16704t30.16704 12.4928 30.16704-12.4928\n              12.4928-30.16704l0-512q0-17.67424-12.4928-30.16704t-30.16704-12.4928zM682.65984\n              213.34016q-17.67424 0-30.16704 12.4928t-12.4928 30.16704l0 512q0\n              17.67424 12.4928 30.16704t30.16704 12.4928 30.16704-12.4928\n              12.4928-30.16704l0-512q0-17.67424-12.4928-30.16704t-30.16704-12.4928z");
      attr(svg, "class", "icon");
      attr(svg, "viewBox", "0 0 1024 1024");
      attr(svg, "version", "1.1");
      attr(svg, "xmlns", "http://www.w3.org/2000/svg");
      attr(svg, "xmlns:xlink", "http://www.w3.org/1999/xlink");
      attr(svg, "width", "16");
      attr(svg, "height", "16");
    },
    m(target, anchor) {
      insert(target, svg, anchor);
      append(svg, path);
    },
    d(detaching) {
      if (detaching) {
        detach(svg);
      }
    }
  };
}
function create_each_block(ctx) {
  let button;
  let t0_value = (
    /*s*/
    ctx[38] + ""
  );
  let t0;
  let t1;
  let button_disabled_value;
  let mounted;
  let dispose;
  function click_handler() {
    return (
      /*click_handler*/
      ctx[28](
        /*s*/
        ctx[38]
      )
    );
  }
  return {
    c() {
      button = element("button");
      t0 = text(t0_value);
      t1 = text("x");
      button.disabled = button_disabled_value = /*speedState*/
      ctx[10] === "skipping";
      attr(button, "class", "svelte-189zk2r");
      toggle_class(
        button,
        "active",
        /*s*/
        ctx[38] === /*speed*/
        ctx[1] && /*speedState*/
        ctx[10] !== "skipping"
      );
    },
    m(target, anchor) {
      insert(target, button, anchor);
      append(button, t0);
      append(button, t1);
      if (!mounted) {
        dispose = listen(button, "click", click_handler);
        mounted = true;
      }
    },
    p(new_ctx, dirty) {
      ctx = new_ctx;
      if (dirty[0] & /*speedOption*/
      8 && t0_value !== (t0_value = /*s*/
      ctx[38] + "")) set_data(t0, t0_value);
      if (dirty[0] & /*speedState*/
      1024 && button_disabled_value !== (button_disabled_value = /*speedState*/
      ctx[10] === "skipping")) {
        button.disabled = button_disabled_value;
      }
      if (dirty[0] & /*speedOption, speed, speedState*/
      1034) {
        toggle_class(
          button,
          "active",
          /*s*/
          ctx[38] === /*speed*/
          ctx[1] && /*speedState*/
          ctx[10] !== "skipping"
        );
      }
    },
    d(detaching) {
      if (detaching) {
        detach(button);
      }
      mounted = false;
      dispose();
    }
  };
}
function create_fragment$1(ctx) {
  let if_block_anchor;
  let current;
  let if_block = (
    /*showController*/
    ctx[2] && create_if_block$1(ctx)
  );
  return {
    c() {
      if (if_block) if_block.c();
      if_block_anchor = empty();
    },
    m(target, anchor) {
      if (if_block) if_block.m(target, anchor);
      insert(target, if_block_anchor, anchor);
      current = true;
    },
    p(ctx2, dirty) {
      if (
        /*showController*/
        ctx2[2]
      ) {
        if (if_block) {
          if_block.p(ctx2, dirty);
          if (dirty[0] & /*showController*/
          4) {
            transition_in(if_block, 1);
          }
        } else {
          if_block = create_if_block$1(ctx2);
          if_block.c();
          transition_in(if_block, 1);
          if_block.m(if_block_anchor.parentNode, if_block_anchor);
        }
      } else if (if_block) {
        group_outros();
        transition_out(if_block, 1, 1, () => {
          if_block = null;
        });
        check_outros();
      }
    },
    i(local) {
      if (current) return;
      transition_in(if_block);
      current = true;
    },
    o(local) {
      transition_out(if_block);
      current = false;
    },
    d(detaching) {
      if (detaching) {
        detach(if_block_anchor);
      }
      if (if_block) if_block.d(detaching);
    }
  };
}
function position(startTime, endTime, tagTime) {
  const sessionDuration = endTime - startTime;
  const eventDuration = endTime - tagTime;
  const eventPosition = 100 - eventDuration / sessionDuration * 100;
  return eventPosition.toFixed(2);
}
function instance$1($$self, $$props, $$invalidate) {
  const dispatch = createEventDispatcher();
  let { replayer } = $$props;
  let { showController } = $$props;
  let { autoPlay } = $$props;
  let { skipInactive } = $$props;
  let { speedOption } = $$props;
  let { speed = speedOption.length ? speedOption[0] : 1 } = $$props;
  let { tags = {} } = $$props;
  let { inactiveColor } = $$props;
  let currentTime = 0;
  let timer = null;
  let playerState;
  let speedState;
  let progress;
  let finished;
  let pauseAt = false;
  let onPauseHook = null;
  let loop = null;
  let meta;
  let percentage;
  let customEvents;
  let inactivePeriods;
  const loopTimer = () => {
    stopTimer();
    function update2() {
      $$invalidate(6, currentTime = replayer.getCurrentTime());
      if (pauseAt && currentTime >= pauseAt) {
        if (loop) {
          playRange(loop.start, loop.end, true, void 0);
        } else {
          replayer.pause();
          if (onPauseHook) {
            onPauseHook();
            onPauseHook = null;
          }
        }
      }
      if (currentTime < meta.totalTime) {
        timer = requestAnimationFrame(update2);
      }
    }
    timer = requestAnimationFrame(update2);
  };
  const stopTimer = () => {
    if (timer) {
      cancelAnimationFrame(timer);
      timer = null;
    }
  };
  const toggle = () => {
    switch (playerState) {
      case "playing":
        pause();
        break;
      case "paused":
        play();
        break;
    }
  };
  const play = () => {
    if (playerState !== "paused") {
      return;
    }
    if (finished) {
      replayer.play();
      finished = false;
    } else {
      replayer.play(currentTime);
    }
  };
  const pause = () => {
    if (playerState !== "playing") {
      return;
    }
    replayer.pause();
    pauseAt = false;
  };
  const goto = (timeOffset, play2) => {
    $$invalidate(6, currentTime = timeOffset);
    pauseAt = false;
    finished = false;
    const resumePlaying = typeof play2 === "boolean" ? play2 : playerState === "playing";
    if (resumePlaying) {
      replayer.play(timeOffset);
    } else {
      replayer.pause(timeOffset);
    }
  };
  const playRange = (timeOffset, endTimeOffset, startLooping = false, afterHook = void 0) => {
    if (startLooping) {
      loop = { start: timeOffset, end: endTimeOffset };
    } else {
      loop = null;
    }
    $$invalidate(6, currentTime = timeOffset);
    pauseAt = endTimeOffset;
    onPauseHook = afterHook || null;
    replayer.play(timeOffset);
  };
  const handleProgressClick = (event) => {
    if (speedState === "skipping") {
      return;
    }
    const progressRect = progress.getBoundingClientRect();
    const x = event.clientX - progressRect.left;
    let percent = x / progressRect.width;
    if (percent < 0) {
      percent = 0;
    } else if (percent > 1) {
      percent = 1;
    }
    const timeOffset = meta.totalTime * percent;
    goto(timeOffset);
  };
  const handleProgressKeydown = (event) => {
    if (speedState === "skipping") {
      return;
    }
    if (event.key === "ArrowLeft") {
      goto(currentTime - 5);
    } else if (event.key === "ArrowRight") {
      goto(currentTime + 5);
    }
  };
  const setSpeed = (newSpeed) => {
    let needFreeze = playerState === "playing";
    $$invalidate(1, speed = newSpeed);
    if (needFreeze) {
      replayer.pause();
    }
    replayer.setConfig({ speed });
    if (needFreeze) {
      replayer.play(currentTime);
    }
  };
  const toggleSkipInactive = () => {
    $$invalidate(0, skipInactive = !skipInactive);
  };
  const triggerUpdateMeta = () => {
    return Promise.resolve().then(() => {
      $$invalidate(8, meta = replayer.getMetaData());
    });
  };
  onMount(() => {
    $$invalidate(7, playerState = replayer.service.state.value);
    $$invalidate(10, speedState = replayer.speedService.state.value);
    replayer.on("state-change", (states) => {
      const { player, speed: speed2 } = states;
      if ((player == null ? void 0 : player.value) && playerState !== player.value) {
        $$invalidate(7, playerState = player.value);
        switch (playerState) {
          case "playing":
            loopTimer();
            break;
          case "paused":
            stopTimer();
            break;
        }
      }
      if ((speed2 == null ? void 0 : speed2.value) && speedState !== speed2.value) {
        $$invalidate(10, speedState = speed2.value);
      }
    });
    replayer.on("finish", () => {
      finished = true;
      if (onPauseHook) {
        onPauseHook();
        onPauseHook = null;
      }
    });
    if (autoPlay) {
      replayer.play();
    }
  });
  afterUpdate(() => {
    if (skipInactive !== replayer.config.skipInactive) {
      replayer.setConfig({ skipInactive });
    }
  });
  onDestroy(() => {
    replayer.pause();
    stopTimer();
  });
  function div2_binding($$value) {
    binding_callbacks[$$value ? "unshift" : "push"](() => {
      progress = $$value;
      $$invalidate(11, progress);
    });
  }
  const click_handler = (s2) => setSpeed(s2);
  function switch_1_checked_binding(value) {
    skipInactive = value;
    $$invalidate(0, skipInactive);
  }
  const click_handler_1 = () => dispatch("fullscreen");
  $$self.$$set = ($$props2) => {
    if ("replayer" in $$props2) $$invalidate(17, replayer = $$props2.replayer);
    if ("showController" in $$props2) $$invalidate(2, showController = $$props2.showController);
    if ("autoPlay" in $$props2) $$invalidate(18, autoPlay = $$props2.autoPlay);
    if ("skipInactive" in $$props2) $$invalidate(0, skipInactive = $$props2.skipInactive);
    if ("speedOption" in $$props2) $$invalidate(3, speedOption = $$props2.speedOption);
    if ("speed" in $$props2) $$invalidate(1, speed = $$props2.speed);
    if ("tags" in $$props2) $$invalidate(19, tags = $$props2.tags);
    if ("inactiveColor" in $$props2) $$invalidate(20, inactiveColor = $$props2.inactiveColor);
  };
  $$self.$$.update = () => {
    if ($$self.$$.dirty[0] & /*currentTime*/
    64) {
      {
        dispatch("ui-update-current-time", { payload: currentTime });
      }
    }
    if ($$self.$$.dirty[0] & /*playerState*/
    128) {
      {
        dispatch("ui-update-player-state", { payload: playerState });
      }
    }
    if ($$self.$$.dirty[0] & /*replayer*/
    131072) {
      $$invalidate(8, meta = replayer.getMetaData());
    }
    if ($$self.$$.dirty[0] & /*currentTime, meta*/
    320) {
      {
        const percent = Math.min(1, currentTime / meta.totalTime);
        $$invalidate(12, percentage = `${100 * percent}%`);
        dispatch("ui-update-progress", { payload: percent });
      }
    }
    if ($$self.$$.dirty[0] & /*replayer, tags*/
    655360) {
      $$invalidate(9, customEvents = (() => {
        const { context } = replayer.service.state;
        const totalEvents = context.events.length;
        const start = context.events[0].timestamp;
        const end = context.events[totalEvents - 1].timestamp;
        const customEvents2 = [];
        context.events.forEach((event) => {
          if (event.type === EventType.Custom) {
            const customEvent = {
              name: event.data.tag,
              background: tags[event.data.tag] || "rgb(73, 80, 246)",
              position: `${position(start, end, event.timestamp)}%`
            };
            customEvents2.push(customEvent);
          }
        });
        return customEvents2;
      })());
    }
    if ($$self.$$.dirty[0] & /*replayer, inactiveColor*/
    1179648) {
      $$invalidate(13, inactivePeriods = (() => {
        try {
          const { context } = replayer.service.state;
          const totalEvents = context.events.length;
          const start = context.events[0].timestamp;
          const end = context.events[totalEvents - 1].timestamp;
          const periods = getInactivePeriods(context.events, replayer.config.inactivePeriodThreshold);
          const getWidth = (startTime, endTime, tagStart, tagEnd) => {
            const sessionDuration = endTime - startTime;
            const eventDuration = tagEnd - tagStart;
            const width = eventDuration / sessionDuration * 100;
            return width.toFixed(2);
          };
          return periods.map((period) => ({
            name: "inactive period",
            background: inactiveColor,
            position: `${position(start, end, period[0])}%`,
            width: `${getWidth(start, end, period[0], period[1])}%`
          }));
        } catch (e2) {
          return [];
        }
      })());
    }
  };
  return [
    skipInactive,
    speed,
    showController,
    speedOption,
    toggle,
    setSpeed,
    currentTime,
    playerState,
    meta,
    customEvents,
    speedState,
    progress,
    percentage,
    inactivePeriods,
    dispatch,
    handleProgressClick,
    handleProgressKeydown,
    replayer,
    autoPlay,
    tags,
    inactiveColor,
    play,
    pause,
    goto,
    playRange,
    toggleSkipInactive,
    triggerUpdateMeta,
    div2_binding,
    click_handler,
    switch_1_checked_binding,
    click_handler_1
  ];
}
class Controller extends SvelteComponent {
  constructor(options) {
    super();
    init(
      this,
      options,
      instance$1,
      create_fragment$1,
      safe_not_equal,
      {
        replayer: 17,
        showController: 2,
        autoPlay: 18,
        skipInactive: 0,
        speedOption: 3,
        speed: 1,
        tags: 19,
        inactiveColor: 20,
        toggle: 4,
        play: 21,
        pause: 22,
        goto: 23,
        playRange: 24,
        setSpeed: 5,
        toggleSkipInactive: 25,
        triggerUpdateMeta: 26
      },
      null,
      [-1, -1]
    );
  }
  get toggle() {
    return this.$$.ctx[4];
  }
  get play() {
    return this.$$.ctx[21];
  }
  get pause() {
    return this.$$.ctx[22];
  }
  get goto() {
    return this.$$.ctx[23];
  }
  get playRange() {
    return this.$$.ctx[24];
  }
  get setSpeed() {
    return this.$$.ctx[5];
  }
  get toggleSkipInactive() {
    return this.$$.ctx[25];
  }
  get triggerUpdateMeta() {
    return this.$$.ctx[26];
  }
}
function create_if_block(ctx) {
  let controller_1;
  let current;
  let controller_1_props = {
    replayer: (
      /*replayer*/
      ctx[7]
    ),
    showController: (
      /*showController*/
      ctx[3]
    ),
    autoPlay: (
      /*autoPlay*/
      ctx[1]
    ),
    speedOption: (
      /*speedOption*/
      ctx[2]
    ),
    skipInactive: (
      /*skipInactive*/
      ctx[0]
    ),
    tags: (
      /*tags*/
      ctx[4]
    ),
    inactiveColor: (
      /*inactiveColor*/
      ctx[5]
    )
  };
  controller_1 = new Controller({ props: controller_1_props });
  ctx[32](controller_1);
  controller_1.$on(
    "fullscreen",
    /*fullscreen_handler*/
    ctx[33]
  );
  return {
    c() {
      create_component(controller_1.$$.fragment);
    },
    m(target, anchor) {
      mount_component(controller_1, target, anchor);
      current = true;
    },
    p(ctx2, dirty) {
      const controller_1_changes = {};
      if (dirty[0] & /*replayer*/
      128) controller_1_changes.replayer = /*replayer*/
      ctx2[7];
      if (dirty[0] & /*showController*/
      8) controller_1_changes.showController = /*showController*/
      ctx2[3];
      if (dirty[0] & /*autoPlay*/
      2) controller_1_changes.autoPlay = /*autoPlay*/
      ctx2[1];
      if (dirty[0] & /*speedOption*/
      4) controller_1_changes.speedOption = /*speedOption*/
      ctx2[2];
      if (dirty[0] & /*skipInactive*/
      1) controller_1_changes.skipInactive = /*skipInactive*/
      ctx2[0];
      if (dirty[0] & /*tags*/
      16) controller_1_changes.tags = /*tags*/
      ctx2[4];
      if (dirty[0] & /*inactiveColor*/
      32) controller_1_changes.inactiveColor = /*inactiveColor*/
      ctx2[5];
      controller_1.$set(controller_1_changes);
    },
    i(local) {
      if (current) return;
      transition_in(controller_1.$$.fragment, local);
      current = true;
    },
    o(local) {
      transition_out(controller_1.$$.fragment, local);
      current = false;
    },
    d(detaching) {
      ctx[32](null);
      destroy_component(controller_1, detaching);
    }
  };
}
function create_fragment(ctx) {
  let div1;
  let div0;
  let t2;
  let current;
  let if_block = (
    /*replayer*/
    ctx[7] && create_if_block(ctx)
  );
  return {
    c() {
      div1 = element("div");
      div0 = element("div");
      t2 = space();
      if (if_block) if_block.c();
      attr(div0, "class", "rr-player__frame");
      attr(
        div0,
        "style",
        /*style*/
        ctx[11]
      );
      attr(div1, "class", "rr-player");
      attr(
        div1,
        "style",
        /*playerStyle*/
        ctx[12]
      );
    },
    m(target, anchor) {
      insert(target, div1, anchor);
      append(div1, div0);
      ctx[31](div0);
      append(div1, t2);
      if (if_block) if_block.m(div1, null);
      ctx[34](div1);
      current = true;
    },
    p(ctx2, dirty) {
      if (!current || dirty[0] & /*style*/
      2048) {
        attr(
          div0,
          "style",
          /*style*/
          ctx2[11]
        );
      }
      if (
        /*replayer*/
        ctx2[7]
      ) {
        if (if_block) {
          if_block.p(ctx2, dirty);
          if (dirty[0] & /*replayer*/
          128) {
            transition_in(if_block, 1);
          }
        } else {
          if_block = create_if_block(ctx2);
          if_block.c();
          transition_in(if_block, 1);
          if_block.m(div1, null);
        }
      } else if (if_block) {
        group_outros();
        transition_out(if_block, 1, 1, () => {
          if_block = null;
        });
        check_outros();
      }
      if (!current || dirty[0] & /*playerStyle*/
      4096) {
        attr(
          div1,
          "style",
          /*playerStyle*/
          ctx2[12]
        );
      }
    },
    i(local) {
      if (current) return;
      transition_in(if_block);
      current = true;
    },
    o(local) {
      transition_out(if_block);
      current = false;
    },
    d(detaching) {
      if (detaching) {
        detach(div1);
      }
      ctx[31](null);
      if (if_block) if_block.d();
      ctx[34](null);
    }
  };
}
const controllerHeight = 80;
function instance($$self, $$props, $$invalidate) {
  let { width = 1024 } = $$props;
  let { height = 576 } = $$props;
  let { maxScale = 1 } = $$props;
  let { events } = $$props;
  let { skipInactive = true } = $$props;
  let { autoPlay = true } = $$props;
  let { speedOption = [1, 2, 4, 8] } = $$props;
  let { speed = 1 } = $$props;
  let { showController = true } = $$props;
  let { tags = {} } = $$props;
  let { inactiveColor = "#D4D4D4" } = $$props;
  let replayer;
  const getMirror = () => replayer.getMirror();
  let player;
  let frame;
  let fullscreenListener;
  let _width = width;
  let _height = height;
  let controller;
  let style;
  let playerStyle;
  const updateScale = (el, frameDimension) => {
    const widthScale = width / frameDimension.width;
    const heightScale = height / frameDimension.height;
    const scale = [widthScale, heightScale];
    if (maxScale) scale.push(maxScale);
    el.style.transform = `scale(${Math.min(...scale)})translate(-50%, -50%)`;
  };
  const triggerResize = () => {
    updateScale(replayer.wrapper, {
      width: replayer.iframe.offsetWidth,
      height: replayer.iframe.offsetHeight
    });
  };
  const toggleFullscreen = () => {
    if (player) {
      isFullscreen() ? exitFullscreen() : openFullscreen(player);
    }
  };
  const addEventListener = (event, handler) => {
    replayer.on(event, handler);
    switch (event) {
      case "ui-update-current-time":
      case "ui-update-progress":
      case "ui-update-player-state":
        controller.$on(event, ({ detail }) => handler(detail));
    }
  };
  const addEvent = (event) => {
    replayer.addEvent(event);
    controller.triggerUpdateMeta();
  };
  const getMetaData = () => replayer.getMetaData();
  const getReplayer = () => replayer;
  const toggle = () => {
    controller.toggle();
  };
  const setSpeed = (speed2) => {
    controller.setSpeed(speed2);
  };
  const toggleSkipInactive = () => {
    controller.toggleSkipInactive();
  };
  const play = () => {
    controller.play();
  };
  const pause = () => {
    controller.pause();
  };
  const goto = (timeOffset, play2) => {
    controller.goto(timeOffset, play2);
  };
  const playRange = (timeOffset, endTimeOffset, startLooping = false, afterHook = void 0) => {
    controller.playRange(timeOffset, endTimeOffset, startLooping, afterHook);
  };
  onMount(() => {
    if (speedOption !== void 0 && typeOf(speedOption) !== "array") {
      throw new Error("speedOption must be array");
    }
    speedOption.forEach((item) => {
      if (typeOf(item) !== "number") {
        throw new Error("item of speedOption must be number");
      }
    });
    if (speedOption.indexOf(speed) < 0) {
      throw new Error(`speed must be one of speedOption,
        current config:
        {
          ...
          speed: ${speed},
          speedOption: [${speedOption.toString()}]
          ...
        }
        `);
    }
    $$invalidate(7, replayer = new Replayer(
      events,
      __spreadValues({
        speed,
        root: frame,
        unpackFn: unpack
      }, $$props)
    ));
    replayer.on("resize", (dimension) => {
      updateScale(replayer.wrapper, dimension);
    });
    fullscreenListener = onFullscreenChange(() => {
      if (isFullscreen()) {
        setTimeout(
          () => {
            _width = width;
            _height = height;
            $$invalidate(13, width = player.offsetWidth);
            $$invalidate(14, height = player.offsetHeight - (showController ? controllerHeight : 0));
            updateScale(replayer.wrapper, {
              width: replayer.iframe.offsetWidth,
              height: replayer.iframe.offsetHeight
            });
          },
          0
        );
      } else {
        $$invalidate(13, width = _width);
        $$invalidate(14, height = _height);
        updateScale(replayer.wrapper, {
          width: replayer.iframe.offsetWidth,
          height: replayer.iframe.offsetHeight
        });
      }
    });
  });
  onDestroy(() => {
    fullscreenListener && fullscreenListener();
  });
  function div0_binding($$value) {
    binding_callbacks[$$value ? "unshift" : "push"](() => {
      frame = $$value;
      $$invalidate(9, frame);
    });
  }
  function controller_1_binding($$value) {
    binding_callbacks[$$value ? "unshift" : "push"](() => {
      controller = $$value;
      $$invalidate(10, controller);
    });
  }
  const fullscreen_handler = () => toggleFullscreen();
  function div1_binding($$value) {
    binding_callbacks[$$value ? "unshift" : "push"](() => {
      player = $$value;
      $$invalidate(8, player);
    });
  }
  $$self.$$set = ($$new_props) => {
    $$invalidate(39, $$props = assign(assign({}, $$props), exclude_internal_props($$new_props)));
    if ("width" in $$new_props) $$invalidate(13, width = $$new_props.width);
    if ("height" in $$new_props) $$invalidate(14, height = $$new_props.height);
    if ("maxScale" in $$new_props) $$invalidate(15, maxScale = $$new_props.maxScale);
    if ("events" in $$new_props) $$invalidate(16, events = $$new_props.events);
    if ("skipInactive" in $$new_props) $$invalidate(0, skipInactive = $$new_props.skipInactive);
    if ("autoPlay" in $$new_props) $$invalidate(1, autoPlay = $$new_props.autoPlay);
    if ("speedOption" in $$new_props) $$invalidate(2, speedOption = $$new_props.speedOption);
    if ("speed" in $$new_props) $$invalidate(17, speed = $$new_props.speed);
    if ("showController" in $$new_props) $$invalidate(3, showController = $$new_props.showController);
    if ("tags" in $$new_props) $$invalidate(4, tags = $$new_props.tags);
    if ("inactiveColor" in $$new_props) $$invalidate(5, inactiveColor = $$new_props.inactiveColor);
  };
  $$self.$$.update = () => {
    if ($$self.$$.dirty[0] & /*width, height*/
    24576) {
      $$invalidate(11, style = inlineCss({
        width: `${width}px`,
        height: `${height}px`
      }));
    }
    if ($$self.$$.dirty[0] & /*width, height, showController*/
    24584) {
      $$invalidate(12, playerStyle = inlineCss({
        width: `${width}px`,
        height: `${height + (showController ? controllerHeight : 0)}px`
      }));
    }
  };
  $$props = exclude_internal_props($$props);
  return [
    skipInactive,
    autoPlay,
    speedOption,
    showController,
    tags,
    inactiveColor,
    toggleFullscreen,
    replayer,
    player,
    frame,
    controller,
    style,
    playerStyle,
    width,
    height,
    maxScale,
    events,
    speed,
    getMirror,
    triggerResize,
    addEventListener,
    addEvent,
    getMetaData,
    getReplayer,
    toggle,
    setSpeed,
    toggleSkipInactive,
    play,
    pause,
    goto,
    playRange,
    div0_binding,
    controller_1_binding,
    fullscreen_handler,
    div1_binding
  ];
}
let Player$1 = class Player extends SvelteComponent {
  constructor(options) {
    super();
    init(
      this,
      options,
      instance,
      create_fragment,
      safe_not_equal,
      {
        width: 13,
        height: 14,
        maxScale: 15,
        events: 16,
        skipInactive: 0,
        autoPlay: 1,
        speedOption: 2,
        speed: 17,
        showController: 3,
        tags: 4,
        inactiveColor: 5,
        getMirror: 18,
        triggerResize: 19,
        toggleFullscreen: 6,
        addEventListener: 20,
        addEvent: 21,
        getMetaData: 22,
        getReplayer: 23,
        toggle: 24,
        setSpeed: 25,
        toggleSkipInactive: 26,
        play: 27,
        pause: 28,
        goto: 29,
        playRange: 30
      },
      null,
      [-1, -1]
    );
  }
  get getMirror() {
    return this.$$.ctx[18];
  }
  get triggerResize() {
    return this.$$.ctx[19];
  }
  get toggleFullscreen() {
    return this.$$.ctx[6];
  }
  get addEventListener() {
    return this.$$.ctx[20];
  }
  get addEvent() {
    return this.$$.ctx[21];
  }
  get getMetaData() {
    return this.$$.ctx[22];
  }
  get getReplayer() {
    return this.$$.ctx[23];
  }
  get toggle() {
    return this.$$.ctx[24];
  }
  get setSpeed() {
    return this.$$.ctx[25];
  }
  get toggleSkipInactive() {
    return this.$$.ctx[26];
  }
  get play() {
    return this.$$.ctx[27];
  }
  get pause() {
    return this.$$.ctx[28];
  }
  get goto() {
    return this.$$.ctx[29];
  }
  get playRange() {
    return this.$$.ctx[30];
  }
};
class Player2 extends Player$1 {
  constructor(options) {
    super({
      target: options.target,
      props: options.data || options.props
    });
  }
}
exports.Player = Player2;
exports.default = Player2;
if (typeof module.exports == "object" && typeof exports == "object") {
  var __cp = (to, from, except, desc) => {
    if ((from && typeof from === "object") || typeof from === "function") {
      for (let key of Object.getOwnPropertyNames(from)) {
        if (!Object.prototype.hasOwnProperty.call(to, key) && key !== except)
        Object.defineProperty(to, key, {
          get: () => from[key],
          enumerable: !(desc = Object.getOwnPropertyDescriptor(from, key)) || desc.enumerable,
        });
      }
    }
    return to;
  };
  module.exports = __cp(module.exports, exports);
}
return module.exports;
}))
//# sourceMappingURL=rrweb-player.umd.cjs.map
