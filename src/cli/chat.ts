import { startTui } from "../tui/tui.js";

export async function chatCommand(): Promise<void> {
  await startTui();
}
