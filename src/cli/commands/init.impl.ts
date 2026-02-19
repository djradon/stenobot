import type { LocalContext } from "../context.js";
import { generateDefaultConfig } from "../../config.js";

interface InitFlags {
  force?: boolean;
}

export async function initImpl(
  this: LocalContext,
  flags: InitFlags,
): Promise<void> {
  const result = await generateDefaultConfig(flags.force ?? false);

  if (result.created) {
    this.process.stdout.write(`Config written to ${result.path}\n`);
  } else {
    this.process.stdout.write(
      `Config already exists at ${result.path}. Use --force to overwrite.\n`,
    );
  }
}
