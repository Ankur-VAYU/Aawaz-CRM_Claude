// Vercel serverless function. Every path is sent here by vercel.json; the compiled app in dist/
// is produced by the "vercel-build" script before Vercel packages this function.
export { default } from '../dist/vercel.js';
