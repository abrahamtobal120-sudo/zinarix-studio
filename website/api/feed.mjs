// Vercel function: /api/feed (see _lib/core.mjs for what it does and the variables it needs).
import { makeService, vercelHandler } from './_lib/core.mjs';
import { supabaseStore } from './_lib/store.mjs';

export default vercelHandler('feed', makeService(supabaseStore(process.env), process.env));
