import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/bin/cli.ts"],
  format: ["esm"],
  tsconfig: "src/tsconfig.json",
  clean: true,
  splitting: true,
  minify: true,
});
