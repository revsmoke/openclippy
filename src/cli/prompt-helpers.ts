import type * as readline from "node:readline";

export type PromptOption = {
  label: string;
  value: string;
  description?: string;
  selected?: boolean;
};

/**
 * Wraps rl.question in a Promise.
 */
function question(rl: readline.Interface, query: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      resolve(answer);
    });
  });
}

/**
 * Prompt the user for free-text input with an optional default.
 */
export async function prompt(
  rl: readline.Interface,
  message: string,
  defaultValue?: string,
): Promise<string> {
  const suffix = defaultValue !== undefined ? ` [${defaultValue}]` : "";
  const raw = await question(rl, `${message}${suffix} `);
  const trimmed = raw.trim();
  if (trimmed === "" && defaultValue !== undefined) {
    return defaultValue;
  }
  return trimmed;
}

/**
 * Display numbered options and ask the user to pick one.
 * Re-prompts on invalid input until a valid selection is made.
 * Uses recursive rl.question() calls to avoid consuming the stream
 * (for-await on readline closes the interface on exit).
 */
export async function select(
  rl: readline.Interface,
  message: string,
  options: PromptOption[],
): Promise<string> {
  rl.output?.write(`${message}\n`);
  for (let i = 0; i < options.length; i++) {
    const opt = options[i];
    const desc = opt.description ? ` - ${opt.description}` : "";
    rl.output?.write(`  ${i + 1}) ${opt.label}${desc}\n`);
  }

  const ask = (): Promise<string> =>
    question(rl, "Select: ").then((line) => {
      const num = parseInt(line.trim(), 10);
      if (!isNaN(num) && num >= 1 && num <= options.length) {
        return options[num - 1].value;
      }
      rl.output?.write(
        `Invalid selection. Enter a number between 1 and ${options.length}.\n`,
      );
      return ask();
    });

  return ask();
}

/**
 * Display numbered options with checkboxes and let the user pick multiple.
 * Accepts comma-separated numbers, "all", or empty input (returns pre-selected).
 */
export async function multiSelect(
  rl: readline.Interface,
  message: string,
  options: PromptOption[],
): Promise<string[]> {
  rl.output?.write(`${message}\n`);
  for (let i = 0; i < options.length; i++) {
    const opt = options[i];
    const check = opt.selected ? "[x]" : "[ ]";
    const desc = opt.description ? ` - ${opt.description}` : "";
    rl.output?.write(`  ${i + 1}) ${check} ${opt.label}${desc}\n`);
  }

  const raw = await question(rl, "Select (comma-separated, 'all', or Enter for defaults): ");
  const trimmed = raw.trim();

  // Empty input: return pre-selected options
  if (trimmed === "") {
    return options.filter((o) => o.selected).map((o) => o.value);
  }

  // "all" keyword: return all options
  if (trimmed.toLowerCase() === "all") {
    return options.map((o) => o.value);
  }

  // Comma-separated numbers
  const indices = trimmed.split(",").map((s) => parseInt(s.trim(), 10));
  return indices
    .filter((n) => !isNaN(n) && n >= 1 && n <= options.length)
    .map((n) => options[n - 1].value);
}

/**
 * Ask a yes/no confirmation question.
 */
export async function confirm(
  rl: readline.Interface,
  message: string,
  defaultYes?: boolean,
): Promise<boolean> {
  const hint = defaultYes ? "(Y/n)" : "(y/N)";
  const raw = await question(rl, `${message} ${hint} `);
  const trimmed = raw.trim().toLowerCase();

  if (trimmed === "") {
    return defaultYes === true;
  }

  return trimmed === "y";
}
