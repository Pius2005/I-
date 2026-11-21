// Vercel entry point.
//
// The import is static on purpose: Vercel's file tracer follows it and ships
// `server/dist` and its dependencies with the function. `server/dist` is built
// by `npm run build:vercel` before the function is packaged.
import handler from '../server/dist/src/serverless.js';

export default handler;
