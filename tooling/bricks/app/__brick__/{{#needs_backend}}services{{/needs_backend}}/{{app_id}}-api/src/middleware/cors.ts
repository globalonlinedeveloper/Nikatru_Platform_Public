import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types';

// Minimal CORS. ALLOWED_ORIGINS is a comma-separated allowlist; empty/absent
// falls back to '*' (template mode — tighten per app before launch).
export const corsMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const origin = c.req.header('Origin') ?? '';
  const allow = (c.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const allowed =
    allow.length === 0 ? '*' : allow.includes(origin) ? origin : '';
  if (allowed) {
    c.header('Access-Control-Allow-Origin', allowed);
    c.header('Vary', 'Origin');
    c.header(
      'Access-Control-Allow-Headers',
      'Authorization, Content-Type, x-request-id',
    );
    c.header(
      'Access-Control-Allow-Methods',
      'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    );
  }
  if (c.req.method === 'OPTIONS') {
    return c.body(null, 204);
  }
  await next();
  return;
};
