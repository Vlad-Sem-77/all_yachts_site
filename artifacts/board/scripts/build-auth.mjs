import { build } from "esbuild";

await build({
  entryPoints: ["client/forum-auth.tsx"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2020",
  outfile: "public/forum-auth.js",
  define: {
    "import.meta.env.VITE_CLERK_PUBLISHABLE_KEY": JSON.stringify(process.env.CLERK_PUBLISHABLE_KEY ?? ""),
    "import.meta.env.VITE_CLERK_PROXY_URL": JSON.stringify(process.env.VITE_CLERK_PROXY_URL ?? ""),
  },
});
