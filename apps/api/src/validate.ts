/**
 * Minimal JSON-schema validator covering exactly the shapes used in
 * packages/registry/registry.ts: object/required/properties, string, number,
 * boolean, array(+items), enum. Deliberately dependency-free (brief: no new
 * deps); registry schemas are reviewed, so exotic keywords never appear.
 */

export interface SchemaNode {
  type?: string;
  enum?: unknown[];
  required?: string[];
  properties?: Record<string, SchemaNode>;
  items?: SchemaNode;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export function validateAgainstSchema(
  schema: SchemaNode | undefined,
  value: unknown,
  opts: { coerce?: boolean } = {},
  path = '$',
): ValidationIssue[] {
  if (!schema) return [];
  const issues: ValidationIssue[] = [];

  if (schema.enum) {
    if (!schema.enum.includes(value)) {
      issues.push({ path, message: `expected one of ${JSON.stringify(schema.enum)}` });
    }
    return issues;
  }

  switch (schema.type) {
    case 'string':
      if (typeof value !== 'string') issues.push({ path, message: 'expected string' });
      break;
    case 'number':
    case 'integer': {
      // GET inputs arrive via query string; coerce numeric strings when asked.
      const ok =
        typeof value === 'number' ||
        (opts.coerce === true && typeof value === 'string' && value !== '' && !Number.isNaN(Number(value)));
      if (!ok) issues.push({ path, message: 'expected number' });
      break;
    }
    case 'boolean':
      if (typeof value !== 'boolean') issues.push({ path, message: 'expected boolean' });
      break;
    case 'array':
      if (!Array.isArray(value)) {
        issues.push({ path, message: 'expected array' });
      } else if (schema.items) {
        value.forEach((item, i) => {
          issues.push(...validateAgainstSchema(schema.items, item, opts, `${path}[${i}]`));
        });
      }
      break;
    case 'object':
    case undefined: {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        issues.push({ path, message: 'expected object' });
        break;
      }
      const record = value as Record<string, unknown>;
      for (const key of schema.required ?? []) {
        if (record[key] === undefined) issues.push({ path: `${path}.${key}`, message: 'required' });
      }
      for (const [key, propSchema] of Object.entries(schema.properties ?? {})) {
        if (record[key] !== undefined) {
          issues.push(...validateAgainstSchema(propSchema, record[key], opts, `${path}.${key}`));
        }
      }
      break;
    }
    default:
      // Unknown type keyword — reviewed registry never produces this; fail closed.
      issues.push({ path, message: `unsupported schema type '${schema.type}'` });
  }
  return issues;
}
