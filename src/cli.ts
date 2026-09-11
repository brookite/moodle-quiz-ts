#!/usr/bin/env node
import { extname } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { GiftReader, GiftWriter } from "./gift-format.js";
import { Quiz } from "./model.js";
import { dumpXml, XmlReader } from "./xml-format.js";

type Format = "xml" | "gift";

class UsageError extends Error {}

function usage(): never {
  console.error(`Usage:
  moodle-quiz convert <input> [output] [--from xml|gift] [--to xml|gift] [--no-strict]
  moodle-quiz info <input> [--from xml|gift] [--list] [--no-strict]`);
  throw new UsageError("Invalid command line");
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function formatFor(path: string, explicit?: string): Format {
  if (explicit === "xml" || explicit === "gift") return explicit;
  const extension = extname(path).toLowerCase();
  if (extension === ".xml") return "xml";
  if (extension === ".gift" || extension === ".txt") return "gift";
  throw new Error(
    `Cannot infer format from ${JSON.stringify(path)}; use --from or --to`,
  );
}

function parse(
  source: string,
  format: Format,
  strict: boolean,
): { quiz: Quiz; warnings: string[] } {
  const reader =
    format === "xml" ? new XmlReader({ strict }) : new GiftReader({ strict });
  return { quiz: reader.parse(source), warnings: reader.errors };
}

async function main() {
  const args = process.argv.slice(2);
  const command = args.shift();
  if (command !== "convert" && command !== "info") usage();
  const positional = args.filter(
    (value, index) =>
      !value.startsWith("--") &&
      !["--from", "--to"].includes(args[index - 1] ?? ""),
  );
  const input = positional[0];
  if (!input) usage();
  const strict = !args.includes("--no-strict");
  const sourceFormat = formatFor(input, option(args, "--from"));
  const { quiz, warnings } = parse(
    await readFile(input, "utf8"),
    sourceFormat,
    strict,
  );
  for (const warning of warnings) console.error(`warning: ${warning}`);

  if (command === "info") {
    const counts = new Map<string, number>();
    for (const question of quiz)
      counts.set(question.qtype, (counts.get(question.qtype) ?? 0) + 1);
    console.log(`Questions: ${quiz.realQuestions().length}`);
    console.log(`Entries: ${quiz.length}`);
    for (const [type, count] of [...counts].sort())
      console.log(`${type}: ${count}`);
    if (args.includes("--list"))
      for (const question of quiz)
        console.log(
          `${question.qtype}\t${question.name || ("category" in question ? question.category : "")}`,
        );
    return;
  }

  const output = positional[1];
  const targetFormat = output
    ? formatFor(output, option(args, "--to"))
    : formatFor(
        sourceFormat === "xml" ? "output.gift" : "output.xml",
        option(args, "--to"),
      );
  let rendered: string;
  if (targetFormat === "xml") rendered = dumpXml(quiz);
  else {
    const writer = new GiftWriter({ strict });
    rendered = writer.dump(quiz);
    for (const warning of writer.skipped) console.error(`warning: ${warning}`);
  }
  if (output) await writeFile(output, rendered, "utf8");
  else process.stdout.write(rendered);
}

main().catch((error: unknown) => {
  if (error instanceof UsageError) process.exitCode = 2;
  else {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
});
