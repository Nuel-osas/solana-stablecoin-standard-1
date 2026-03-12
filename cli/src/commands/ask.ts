import { Command } from "commander";
import {
  c,
  _env,
  fs,
  path,
} from "./shared";

export function registerAskCommands(cli: Command): void {
  cli
    .command("ask")
    .description("Natural-language interface — describe what you want and the AI translates it to the right sss-token command")
    .argument("<prompt...>", "What you want to do, in plain English")
    .option("--execute", "Execute the command immediately without confirmation")
    .option("--model <model>", "Groq model to use", "llama-3.3-70b-versatile")
    .action(async (promptParts: string[], opts: { execute?: boolean; model?: string }) => {
      const prompt = promptParts.join(" ");
      const apiKey = process.env.GROQ_API_KEY || _env.GROQ_API_KEY;
      if (!apiKey) {
        console.error(`\n  ${c.red}Error:${c.reset} GROQ_API_KEY environment variable is required.`);
        console.error(`  Get a free key at ${c.cyan}https://console.groq.com/keys${c.reset}`);
        process.exit(1);
      }

      // Load SKILLS.md as context
      let skillsContext = "";
      try {
        const skillsPath = path.resolve(__dirname, "../../../SKILLS.md");
        skillsContext = fs.readFileSync(skillsPath, "utf-8");
      } catch {
        console.error(`\n  ${c.yellow}Warning:${c.reset} SKILLS.md not found, using built-in command knowledge.`);
      }

      const systemPrompt = `You are an assistant that translates natural language into sss-token CLI commands.

${skillsContext}

Rules:
- Output ONLY the exact CLI command(s), one per line. No explanation, no markdown, no backticks.
- Use real addresses/values the user provides. Use <placeholder> for values not provided.
- If the request requires multiple steps, output them in order, one per line.
- If the request is unclear or impossible with the available commands, respond with: ERROR: <reason>`;

      console.log(`\n  ${c.dim}Thinking...${c.reset}`);

      try {
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: opts.model || "llama-3.3-70b-versatile",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: prompt },
            ],
            temperature: 0,
            max_tokens: 512,
          }),
        });

        if (!res.ok) {
          const errBody = await res.text();
          console.error(`\n  ${c.red}Groq API error (${res.status}):${c.reset} ${errBody}`);
          process.exit(1);
        }

        const data = (await res.json()) as any;
        const reply = data.choices?.[0]?.message?.content?.trim();

        if (!reply) {
          console.error(`\n  ${c.red}No response from Groq.${c.reset}`);
          process.exit(1);
        }

        if (reply.startsWith("ERROR:")) {
          console.error(`\n  ${c.yellow}${reply}${c.reset}`);
          process.exit(1);
        }

        const commands = reply.split("\n").filter((l: string) => l.trim().length > 0);

        console.log(`\n  ${c.green}${c.bold}Generated command${commands.length > 1 ? "s" : ""}:${c.reset}`);
        for (const cmd of commands) {
          console.log(`  ${c.cyan}$ ${cmd}${c.reset}`);
        }

        if (opts.execute) {
          const { execSync } = require("child_process");
          for (const cmd of commands) {
            if (cmd.includes("<") && cmd.includes(">")) {
              console.log(`\n  ${c.yellow}Skipping (has placeholders):${c.reset} ${cmd}`);
              continue;
            }
            console.log(`\n  ${c.dim}Running: ${cmd}${c.reset}`);
            try {
              execSync(cmd, { stdio: "inherit", cwd: path.resolve(__dirname, "../../..") });
            } catch {
              console.error(`  ${c.red}Command failed.${c.reset}`);
              process.exit(1);
            }
          }
        } else {
          console.log(`\n  ${c.dim}Add ${c.bold}--execute${c.reset}${c.dim} to run automatically, or copy-paste the command above.${c.reset}`);
        }
      } catch (err: any) {
        console.error(`\n  ${c.red}Error:${c.reset} ${err.message || err}`);
        process.exit(1);
      }
    });
}
