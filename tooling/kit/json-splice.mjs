// ─────────────────────────────────────────────────────────────────────────────
// json-splice.mjs — insert into a HAND-KEPT JSON file without re-serialising it.
//
// ⏱ 2026-10-01 (rv2-newproduct-009/-005/-011). The shared files a stamp has to
// extend — the bundle register, the e2e leg register, the mail-transport
// record — are written by hand, in a house style `JSON.stringify` does not
// reproduce (measured: none of the three round-trips). Rewriting one whole to
// add one entry would turn a one-line stamp output into a diff of the entire
// file, and a reviewer reading that diff could not see the line that matters.
//
// So this module locates a value BY PATH in the text, with byte offsets, and
// splices at those offsets. Everything outside the splice keeps its bytes. Each
// caller then re-parses the result and compares it to the value it meant to
// produce (`assertSpliced`), so a splice that landed in the wrong place is a
// thrown error, never a quietly malformed register.
// ─────────────────────────────────────────────────────────────────────────────
import { isDeepStrictEqual } from 'node:util';

/**
 * Parse `text` into a position tree. Each node is
 * `{ type, start, end, members?, items? }` — `members` is `[{ key, value }]`
 * for an object, `items` the element nodes of an array; `end` is exclusive.
 * Throws on text that is not JSON.
 */
export function parseWithSpans(text) {
  let i = 0;
  const ws = () => {
    while (i < text.length && ' \t\r\n'.includes(text[i])) i++;
  };
  const fail = (what) => {
    throw new Error(`json-splice: ${what} at offset ${i}`);
  };
  const string = () => {
    const start = i;
    i++; // the opening quote
    while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    if (i >= text.length) fail('unterminated string');
    i++;
    return { type: 'string', start, end: i, raw: text.slice(start, i) };
  };
  const value = () => {
    ws();
    const start = i;
    const c = text[i];
    if (c === '{') {
      i++;
      const members = [];
      ws();
      if (text[i] === '}') {
        i++;
        return { type: 'object', start, end: i, members };
      }
      for (;;) {
        ws();
        if (text[i] !== '"') fail('expected a key');
        const k = string();
        ws();
        if (text[i] !== ':') fail('expected a colon');
        i++;
        const v = value();
        members.push({ key: JSON.parse(k.raw), keyStart: k.start, value: v });
        ws();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i] === '}') {
          i++;
          return { type: 'object', start, end: i, members };
        }
        fail('expected , or }');
      }
    }
    if (c === '[') {
      i++;
      const items = [];
      ws();
      if (text[i] === ']') {
        i++;
        return { type: 'array', start, end: i, items };
      }
      for (;;) {
        items.push(value());
        ws();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i] === ']') {
          i++;
          return { type: 'array', start, end: i, items };
        }
        fail('expected , or ]');
      }
    }
    if (c === '"') return string();
    const m = /^(?:true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i));
    if (!m) fail('expected a value');
    i += m[0].length;
    return { type: 'scalar', start, end: i };
  };
  const root = value();
  ws();
  if (i !== text.length) fail('trailing text');
  return root;
}

/** The node at `path` (keys and array indexes), or null. */
export function nodeAt(tree, path) {
  let node = tree;
  for (const step of path) {
    if (node?.type === 'object' && typeof step === 'string') node = node.members.find((m) => m.key === step)?.value ?? null;
    else if (node?.type === 'array' && Number.isInteger(step)) node = node.items[step] ?? null;
    else return null;
    if (node === null) return null;
  }
  return node;
}

/** The leading whitespace of the line `pos` sits on. */
export function indentAt(text, pos) {
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
  return /^[ \t]*/.exec(text.slice(lineStart))[0];
}

/** `rendered` (a JSON text whose own lines start at column 0) re-indented so
 *  every line after its first starts with `indent`. */
export function reindent(rendered, indent) {
  return rendered.split('\n').join(`\n${indent}`);
}

const splice = (text, at, end, insert) => `${text.slice(0, at)}${insert}${text.slice(end)}`;

/** Append each rendered item to the array at `path`, one per line, in the
 *  indentation its existing items use (or its key's plus two when it is empty). */
export function appendToArray(text, path, renderedItems) {
  const node = nodeAt(parseWithSpans(text), path);
  if (node?.type !== 'array') throw new Error(`json-splice: ${JSON.stringify(path)} is not an array`);
  if (renderedItems.length === 0) return text;
  if (node.items.length === 0) {
    const outer = indentAt(text, node.start);
    const inner = `${outer}  `;
    return splice(text, node.start, node.end, `[\n${inner}${renderedItems.map((r) => reindent(r, inner)).join(`,\n${inner}`)}\n${outer}]`);
  }
  const last = node.items[node.items.length - 1];
  const inner = indentAt(text, last.start);
  return splice(text, last.end, last.end, renderedItems.map((r) => `,\n${inner}${reindent(r, inner)}`).join(''));
}

/** Add `"key": rendered` to the object at `path`, directly after the member
 *  `after` (or after its last member), in that member's indentation. */
export function addMember(text, path, key, rendered, { after = null } = {}) {
  const node = nodeAt(parseWithSpans(text), path);
  if (node?.type !== 'object') throw new Error(`json-splice: ${JSON.stringify(path)} is not an object`);
  if (node.members.some((m) => m.key === key)) throw new Error(`json-splice: ${JSON.stringify(path)} already has "${key}"`);
  if (node.members.length === 0) throw new Error(`json-splice: ${JSON.stringify(path)} is empty; no indentation to follow`);
  const anchor = after === null ? node.members[node.members.length - 1] : node.members.find((m) => m.key === after);
  if (!anchor) throw new Error(`json-splice: ${JSON.stringify(path)} has no member "${after}"`);
  const inner = indentAt(text, anchor.keyStart);
  return splice(text, anchor.value.end, anchor.value.end, `,\n${inner}${JSON.stringify(key)}: ${reindent(rendered, inner)}`);
}

/** Replace the value at `path` with `rendered`. */
export function replaceValue(text, path, rendered) {
  const node = nodeAt(parseWithSpans(text), path);
  if (node === null) throw new Error(`json-splice: nothing at ${JSON.stringify(path)}`);
  return splice(text, node.start, node.end, rendered);
}

/** Throw unless `text` parses to exactly `expected`: the splice is proven, not assumed. */
export function assertSpliced(text, expected, label) {
  const got = JSON.parse(text);
  if (!isDeepStrictEqual(got, expected)) throw new Error(`json-splice: the spliced ${label} does not parse to the value it was meant to hold`);
}
