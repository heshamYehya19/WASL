// One definition per structured model output: the same combinators produce the JSON Schema sent to the provider AND the
// validator that checks what comes back. A model's output is never trusted because the provider says it "follows the
// schema" — every field is parsed again here, and anything that does not fit is rejected (and retried, then failed safe).

export class SchemaError extends Error {
  path: string
  constructor(path: string, message: string) {
    super(`${path || "response"}: ${message}`)
    this.path = path
  }
}

export interface JsonSchema {
  type: "string" | "integer" | "number" | "boolean" | "array" | "object"
  properties?: Record<string, JsonSchema>
  required?: string[]
  additionalProperties?: false
  items?: JsonSchema
  enum?: string[] | number[]
  description?: string
}

export interface Field<T> {
  schema: JsonSchema
  parse: (value: unknown, path: string) => T
}

export type Infer<F> = F extends Field<infer T> ? T : never

const clean = (s: string) => s.replace(/\r\n/g, "\n").trim()

/** A string. Too short is an error; too long is truncated (verbosity is not a safety problem). */
export function str(opts: { min?: number; max: number; description?: string }): Field<string> {
  return {
    schema: { type: "string", ...(opts.description ? { description: opts.description } : {}) },
    parse(value, path) {
      if (typeof value !== "string") throw new SchemaError(path, "expected text")
      const text = clean(value)
      if (text.length < (opts.min ?? 0)) throw new SchemaError(path, opts.min === 1 ? "must not be empty" : `must be at least ${opts.min} characters`)
      return text.length > opts.max ? text.slice(0, opts.max).trimEnd() : text
    },
  }
}

export function int(opts: { min: number; max: number; description?: string }): Field<number> {
  return {
    schema: { type: "integer", ...(opts.description ? { description: opts.description } : {}) },
    parse(value, path) {
      if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) throw new SchemaError(path, "expected a whole number")
      if (value < opts.min || value > opts.max) throw new SchemaError(path, `must be between ${opts.min} and ${opts.max}`)
      return value
    },
  }
}

export function num(opts: { min: number; max: number; description?: string }): Field<number> {
  return {
    schema: { type: "number", ...(opts.description ? { description: opts.description } : {}) },
    parse(value, path) {
      if (typeof value !== "number" || !Number.isFinite(value)) throw new SchemaError(path, "expected a number")
      if (value < opts.min || value > opts.max) throw new SchemaError(path, `must be between ${opts.min} and ${opts.max}`)
      return value
    },
  }
}

export function bool(description?: string): Field<boolean> {
  return {
    schema: { type: "boolean", ...(description ? { description } : {}) },
    parse(value, path) {
      if (typeof value !== "boolean") throw new SchemaError(path, "expected true or false")
      return value
    },
  }
}

export function oneOf<const V extends readonly string[]>(values: V, description?: string): Field<V[number]> {
  return {
    schema: { type: "string", enum: [...values], ...(description ? { description } : {}) },
    parse(value, path) {
      if (typeof value !== "string" || !values.includes(value)) throw new SchemaError(path, `must be one of ${values.join(", ")}`)
      return value as V[number]
    },
  }
}

/** An array. Fewer than `min` items is an error; more than `max` are dropped. */
export function arr<T>(item: Field<T>, opts: { min?: number; max: number; description?: string }): Field<T[]> {
  return {
    schema: { type: "array", items: item.schema, ...(opts.description ? { description: opts.description } : {}) },
    parse(value, path) {
      if (!Array.isArray(value)) throw new SchemaError(path, "expected a list")
      if (value.length < (opts.min ?? 0)) throw new SchemaError(path, `needs at least ${opts.min} item${opts.min === 1 ? "" : "s"}`)
      return value.slice(0, opts.max).map((v, i) => item.parse(v, `${path}[${i}]`))
    },
  }
}

type Shape = Record<string, Field<unknown>>

/** An object whose every property is required (the strict form OpenAI-compatible providers demand). Extra keys are dropped. */
export function obj<S extends Shape>(shape: S, description?: string): Field<{ [K in keyof S]: Infer<S[K]> }> {
  return {
    schema: {
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries(Object.entries(shape).map(([k, f]) => [k, f.schema])),
      required: Object.keys(shape),
      ...(description ? { description } : {}),
    },
    parse(value, path) {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new SchemaError(path, "expected an object")
      const out: Record<string, unknown> = {}
      for (const [key, field] of Object.entries(shape)) {
        if (!(key in (value as Record<string, unknown>))) throw new SchemaError(path ? `${path}.${key}` : key, "is missing")
        out[key] = field.parse((value as Record<string, unknown>)[key], path ? `${path}.${key}` : key)
      }
      return out as { [K in keyof S]: Infer<S[K]> }
    },
  }
}

/** A named, versioned structured output. */
export interface OutputSpec<T> {
  name: string
  field: Field<T>
}
export const output = <T>(name: string, field: Field<T>): OutputSpec<T> => ({ name, field })

/** Gemini's schema dialect: an OpenAPI subset with upper-case type names and no `additionalProperties`. */
export function toGeminiSchema(schema: JsonSchema): unknown {
  const out: Record<string, unknown> = { type: schema.type.toUpperCase() }
  if (schema.description) out.description = schema.description
  if (schema.enum) out.enum = schema.enum.map(String)
  if (schema.items) out.items = toGeminiSchema(schema.items)
  if (schema.properties) {
    out.properties = Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, toGeminiSchema(v)]))
    out.required = schema.required
  }
  return out
}
