import { spawn } from "node:child_process";

export interface CommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

export class CommandExecutionError extends Error {
  constructor(
    message: string,
    public readonly command: string,
    public readonly args: string[],
    public readonly result: CommandResult,
  ) {
    super(message);
  }
}

export const runCommand = async (
  command: string,
  args: string[],
): Promise<CommandResult> => {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", reject);
    child.on("close", (code) => {
      const result = { stdout, stderr, code: code ?? -1 };
      if (result.code !== 0) {
        reject(
          new CommandExecutionError(
            `Command failed: ${command} ${args.join(" ")}`,
            command,
            args,
            result,
          ),
        );
        return;
      }
      resolve(result);
    });
  });
};
