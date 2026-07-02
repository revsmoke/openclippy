import { Readable, Writable } from "node:stream";
import * as readline from "node:readline";

/**
 * Creates a mock readline.Interface that feeds scripted answers on demand.
 *
 * rl.question is stubbed directly (instead of piping a stream) so answers
 * are delivered exactly when a question is asked — a stream-backed mock
 * drops lines emitted while no question is pending, which makes tests
 * that await other work between prompts hang. Throws loudly when the
 * script runs out of answers.
 */
export function createMockRl(...answers: string[]): readline.Interface {
  const queue = [...answers];
  const rl = readline.createInterface({
    input: new Readable({ read() {} }),
    output: new Writable({
      write(_, __, cb) {
        cb();
      },
    }),
  });

  rl.question = ((query: string, cb: (answer: string) => void) => {
    const next = queue.shift();
    if (next === undefined) {
      throw new Error(`Mock readline ran out of answers (question: ${query})`);
    }
    setImmediate(() => cb(next));
  }) as typeof rl.question;

  return rl;
}
