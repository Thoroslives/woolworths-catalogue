/**
 * The one argv reader the scripts share. Flags named in `valueFlags` consume
 * the argument after them; any other `--flag` is a switch; everything else is
 * positional, in order.
 */
export interface Args {
  values: Record<string, string | undefined>;
  switches: Set<string>;
  positional: string[];
}

export function readArgs(argv: string[], valueFlags: string[]): Args {
  const values: Record<string, string | undefined> = {};
  const switches = new Set<string>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (valueFlags.includes(arg)) {
      values[arg] = argv[i + 1];
      i += 1;
    } else if (arg.startsWith("--")) {
      switches.add(arg);
    } else {
      positional.push(arg);
    }
  }
  return { values, switches, positional };
}
