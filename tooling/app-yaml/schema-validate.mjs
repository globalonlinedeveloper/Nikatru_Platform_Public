// ─────────────────────────────────────────────────────────────────────────────
// schema-validate.mjs — the JSON Schema 2020-12 subset the two declaration
// schemas in `schema/` are written in, and a validator that REFUSES a keyword
// it does not implement.
//
// ── WHY REFUSING UNKNOWN KEYWORDS IS THE WHOLE DESIGN ────────────────────────
// A validator that ignores what it does not understand turns every schema author
// mistake into silence: write `minimumItems` instead of `minItems` and the
// constraint is simply not there, while the schema file still reads as though it
// were and the guard still prints ok. That is this repository's signature defect
// — a check that silently stopped checking — and it is precisely the shape
// `assert-guard-coverage.mjs` was built to hunt. So `UNDERSTOOD` below is the
// complete list, and a schema carrying anything else raises `SchemaError` before
// a single instance is graded.
//
// The same rule applies in the other direction: `additionalProperties: true` is
// refused outright. Every object schema here must close its property set, because
// an open object is how a typo'd field ends up in a declaration that renders a
// public listing and nothing ever mentions it.
//
// Implemented: type · enum · const · required · properties ·
// additionalProperties (false or a schema) · items · minItems · maxItems ·
// uniqueItems · minLength · maxLength · pattern · format (a closed set) ·
// anyOf · allOf. Annotations ($schema, $id, title, description, examples) are
// carried and ignored.
//
// Usage:  const problems = validate(instance, schema);   // [] when it conforms
// ─────────────────────────────────────────────────────────────────────────────

export class SchemaError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SchemaError';
  }
}

const ANNOTATIONS = new Set(['$schema', '$id', 'title', 'description', 'examples', 'default', '_why']);
const UNDERSTOOD = new Set([
  'type', 'enum', 'const', 'required', 'properties', 'additionalProperties',
  'items', 'minItems', 'maxItems', 'uniqueItems',
  'minLength', 'maxLength', 'pattern', 'format',
  'anyOf', 'allOf',
]);

/** A calendar date that round-trips, so `2026-02-31` is not one. THE ONE COPY:
 *  the `date` format below, limb 7 of `tooling/ci/assert-name-clearance.mjs` (by
 *  way of `tooling/scripts/name-ruling.mjs`) and `tooling/ci/assert-ops-register.mjs`
 *  import it. ⏱ 2026-09-24 (the PR 913 review, L2): the format and the ops
 *  register each carried `!Number.isNaN(Date.parse(v))`, and V8 parses
 *  `2026-02-31` as 3 March, so both accepted a day that does not exist while
 *  limb 7 refused it. */
export const isIsoDate = (s) =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/** The closed `format` set. A format nobody implemented must not read as a
 *  constraint that passed — same reason as UNDERSTOOD above. */
const FORMATS = {
  'https-url': (v) => /^https:\/\/[^\s/]+(\/[^\s]*)?$/.test(v),
  hostname: (v) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(v),
  date: isIsoDate,
  'repo-path': (v) => /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(v) && !v.includes('..'),
};

const typeOf = (v) => {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
};

/** Walk the schema once, before any instance is graded, and refuse anything the
 *  grader below would silently skip. Throws `SchemaError`. */
export function assertSchemaUnderstood(schema, where = '#') {
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new SchemaError(`${where}: a schema must be an object`);
  }
  for (const key of Object.keys(schema)) {
    if (ANNOTATIONS.has(key) || UNDERSTOOD.has(key)) continue;
    throw new SchemaError(
      `${where}: keyword "${key}" is not implemented by this validator. Implement it or remove it — an ` +
        'unimplemented keyword is a constraint the schema claims and nothing enforces.',
    );
  }
  if ('additionalProperties' in schema) {
    const ap = schema.additionalProperties;
    if (ap === true) {
      throw new SchemaError(`${where}: additionalProperties:true is refused — every object schema here closes its property set`);
    }
    if (ap !== false) assertSchemaUnderstood(ap, `${where}/additionalProperties`);
  }
  if (schema.properties !== undefined) {
    if (schema.properties === null || typeof schema.properties !== 'object' || Array.isArray(schema.properties)) {
      throw new SchemaError(`${where}/properties: must be an object`);
    }
    for (const [k, v] of Object.entries(schema.properties)) assertSchemaUnderstood(v, `${where}/properties/${k}`);
  }
  if (schema.items !== undefined) assertSchemaUnderstood(schema.items, `${where}/items`);
  for (const branch of ['anyOf', 'allOf']) {
    if (schema[branch] !== undefined) {
      if (!Array.isArray(schema[branch]) || schema[branch].length === 0) {
        throw new SchemaError(`${where}/${branch}: must be a non-empty array of schemas`);
      }
      schema[branch].forEach((s, i) => assertSchemaUnderstood(s, `${where}/${branch}/${i}`));
    }
  }
  if (schema.format !== undefined && !Object.hasOwn(FORMATS, schema.format)) {
    throw new SchemaError(
      `${where}/format: "${schema.format}" has no implementation here. Known: ${Object.keys(FORMATS).join(', ')}.`,
    );
  }
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    for (const t of types) {
      if (!['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'].includes(t)) {
        throw new SchemaError(`${where}/type: "${t}" is not a JSON Schema type`);
      }
    }
  }
  return true;
}

function check(value, schema, path, problems) {
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = typeOf(value);
    const matches = types.some((t) => (t === 'number' ? actual === 'number' || actual === 'integer' : t === actual));
    if (!matches) {
      problems.push(`${path}: expected ${types.join(' or ')}, found ${actual}`);
      return;
    }
  }
  if (schema.const !== undefined && JSON.stringify(value) !== JSON.stringify(schema.const)) {
    problems.push(`${path}: must be ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum !== undefined && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) {
    problems.push(`${path}: ${JSON.stringify(value)} is not one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}`);
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      problems.push(`${path}: ${value.length} character(s), minimum ${schema.minLength}`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      problems.push(`${path}: ${value.length} character(s), maximum ${schema.maxLength}`);
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
      problems.push(`${path}: ${JSON.stringify(value)} does not match ${schema.pattern}`);
    }
    if (schema.format !== undefined && !FORMATS[schema.format](value)) {
      problems.push(`${path}: ${JSON.stringify(value)} is not a valid ${schema.format}`);
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      problems.push(`${path}: ${value.length} item(s), minimum ${schema.minItems}`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      problems.push(`${path}: ${value.length} item(s), maximum ${schema.maxItems}`);
    }
    if (schema.uniqueItems === true) {
      const seen = new Set();
      for (const el of value) {
        const k = JSON.stringify(el);
        if (seen.has(k)) problems.push(`${path}: repeats ${k}`);
        seen.add(k);
      }
    }
    if (schema.items !== undefined) value.forEach((el, i) => check(el, schema.items, `${path}[${i}]`, problems));
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) problems.push(`${path}: required property "${key}" is absent`);
    }
    const props = schema.properties ?? {};
    for (const [key, sub] of Object.entries(value)) {
      if (Object.hasOwn(props, key)) {
        check(sub, props[key], `${path}/${key}`, problems);
      } else if (schema.additionalProperties === false) {
        problems.push(`${path}: "${key}" is not a declared property`);
      } else if (schema.additionalProperties !== undefined) {
        check(sub, schema.additionalProperties, `${path}/${key}`, problems);
      }
    }
  }
  if (schema.allOf !== undefined) for (const s of schema.allOf) check(value, s, path, problems);
  if (schema.anyOf !== undefined) {
    const ok = schema.anyOf.some((s) => {
      const branch = [];
      check(value, s, path, branch);
      return branch.length === 0;
    });
    if (!ok) problems.push(`${path}: matches none of the ${schema.anyOf.length} permitted shapes`);
  }
}

/** Grade `instance` against `schema`. Returns every problem at once — a
 *  validator that stops at the first one turns fixing a declaration into a
 *  guessing game one round-trip at a time. */
export function validate(instance, schema, root = '#') {
  assertSchemaUnderstood(schema, root);
  const problems = [];
  check(instance, schema, root, problems);
  return problems;
}
