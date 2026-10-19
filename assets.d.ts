// Assets
// ======
// What the server imports with an attribute: `type: "text"` brings the
// file's text, `type: "file"` the path the compiled binary carries it at
// (Server.ts WEB sends it with Bun.file). TypeScript cannot see an
// import's attributes, so these say what each kind brings.

declare module "*.md"    { const text: string; export default text; }
declare module "*.txt"   { const text: string; export default text; }
declare module "*.swift" { const text: string; export default text; }

declare module "*.html"  { const path: string; export default path; }
declare module "*.css"   { const path: string; export default path; }
declare module "*.js"    { const path: string; export default path; }
declare module "*.sh"    { const path: string; export default path; }
declare module "*.svg"   { const path: string; export default path; }
declare module "*.jpg"   { const path: string; export default path; }
declare module "*.png"   { const path: string; export default path; }
