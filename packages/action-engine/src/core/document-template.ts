/**
 * action-engine — src/core/document-template.ts
 * Safe document generation from object properties (US 9,223,773).
 *
 * Placeholders: {{property}} and {{#each list}}…{{this}}…{{/each}}.
 * No executable code — substitution only.
 */

export type TemplateContext = Record<string, unknown>;

function lookup(ctx: TemplateContext, path: string): unknown {
  const trimmed = path.trim();
  if (!trimmed) return undefined;
  if (trimmed === 'this') return ctx.this;
  const parts = trimmed.split('.');
  let cur: unknown = ctx;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function stringify(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map((v) => stringify(v)).join(', ');
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

/**
 * Render a template against a property map (object + params).
 * Nested `{{#each}}` is not supported; each block is expanded independently.
 */
export function renderDocumentTemplate(
  template: string,
  context: TemplateContext,
): string {
  const withEach = template.replace(
    /\{\{#each\s+([^}]+)\}\}([\s\S]*?)\{\{\/each\}\}/g,
    (_m, path: string, inner: string) => {
      const list = lookup(context, path);
      const items = Array.isArray(list) ? list : [];
      return items
        .map((item) =>
          inner.replace(/\{\{\s*this\s*\}\}/g, stringify(item)).replace(
            /\{\{\s*([^}]+)\s*\}\}/g,
            (_mm, p: string) => {
              if (p.trim() === 'this') return stringify(item);
              const nested =
                item != null && typeof item === 'object'
                  ? lookup({ ...(item as TemplateContext), this: item }, p)
                  : lookup({ ...context, this: item }, p);
              return stringify(nested);
            },
          ),
        )
        .join('');
    },
  );
  return withEach.replace(/\{\{\s*([^#/][^}]*)\s*\}\}/g, (_m, path: string) =>
    stringify(lookup(context, path)),
  );
}

/** Build a template context from object properties plus action parameters. */
export function templateContextFrom(
  properties: Record<string, unknown>,
  params: Record<string, unknown> = {},
): TemplateContext {
  return { ...properties, ...params, object: properties, params };
}
