import { createProgram } from "./cli/program.js";

export async function main(): Promise<void> {
  const program = createProgram();
  await program.parseAsync(process.argv);
}
