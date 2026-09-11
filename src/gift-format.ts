// This module is a line-by-line port of Moodle's `qformat_gift` plugin
// (`question/format/gift/format.php`), Copyright 2003 Paul Tsuchido Shew,
// licensed under the GNU GPL v3 or later.
// See https://github.com/moodle/moodle/blob/v5.2.2/public/question/format/gift/format.php
//
// This port: Copyright (c) 2026 Brookit.
// Licensed under GPL-3.0-or-later, see LICENSE and README.md.

import { readFile, writeFile } from "node:fs/promises";
import { readFileSync, writeFileSync } from "node:fs";
import { TextFormat, textFormatFromGift, textFormatToGift } from "./enums.js";
import { GiftFormatError } from "./errors.js";
import {
  Answer,
  Calculated,
  Category,
  Cloze,
  Description,
  Essay,
  Matching,
  MultiChoice,
  Numerical,
  NumericalAnswer,
  type AnyQuestion,
  type Question,
  Quiz,
  ShortAnswer,
  Subquestion,
  Text,
  TrueFalse,
} from "./model.js";
import { defaultQuestionName, type ReaderOptions } from "./xml-format.js";

const escaped = ["\\:", "\\#", "\\=", "\\{", "\\}", "\\~", "\\n"];
const placeholders = [
  "&&058;",
  "&&035;",
  "&&061;",
  "&&123;",
  "&&125;",
  "&&126;",
  "&&010",
];
const characters = [":", "#", "=", "{", "}", "~", "\n"];
const reserved = ["\\", "#", "=", "~", "{", "}", ":", "\n", "\r"];
const escapes = ["\\\\", "\\#", "\\=", "\\~", "\\{", "\\}", "\\:", "\\n", ""];
const weightPattern = /^%-*([0-9]{1,2})\.?([0-9]*)%/;
const idPattern = /\[id:((?:\\\]|[^\]\x00-\x1f\x7f])+)\]/;
const tagPattern = /\[tag:((?:\\\]|[^\]<>`\x00-\x1f\x7f])*)\]/g;

export function escapePre(text: string): string {
  let output = text.replaceAll("\\\\", "&&092;");
  escaped.forEach((source, index) => {
    output = output.replaceAll(source, placeholders[index]!);
  });
  return output.replaceAll("&&092;", "\\");
}
export function escapePost(text: string): string {
  let output = text;
  placeholders.forEach((placeholder, index) => {
    output = output.replaceAll(placeholder, characters[index]!);
  });
  return output;
}
export function escapeGift(text: string): string {
  let output = text;
  reserved.forEach((source, index) => {
    output = output.replaceAll(source, escapes[index]!);
  });
  return output;
}

const numString = (value: number): string =>
  Number(value.toFixed(7)).toString();
const weight = (fraction: number): string => numString(fraction * 100);
const isNumeric = (value: string): boolean =>
  value.trim() !== "" && Number.isFinite(Number(value));

export class GiftReader {
  readonly strict: boolean;
  readonly errors: string[] = [];
  constructor(options: ReaderOptions = {}) {
    this.strict = options.strict ?? true;
  }

  parse(source: string): Quiz {
    const quiz = new Quiz();
    for (const block of this.split(source.replace(/^\uFEFF/, ""))) {
      try {
        const question = this.readQuestion(block);
        if (question) quiz.append(question);
      } catch (error) {
        if (this.strict) throw error;
        this.errors.push(
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    return quiz;
  }

  private split(source: string): string[][] {
    const blocks: string[][] = [];
    let current: string[] = [];
    for (const raw of source.replace(/\r\n?/g, "\n").split("\n")) {
      const line = raw.trim();
      if (line) current.push(line);
      else if (current.length) {
        blocks.push(current);
        current = [];
      }
    }
    if (current.length) blocks.push(current);
    return blocks;
  }

  private parseText(text: string, fallback = TextFormat.Moodle): Text {
    let format = fallback;
    if (text.startsWith("[")) {
      const end = text.indexOf("]");
      const named =
        end >= 0 ? textFormatFromGift(text.slice(1, end)) : undefined;
      if (named !== undefined) {
        format = named;
        text = text.slice(end + 1);
      }
    }
    return new Text(escapePost(text).trim(), format);
  }

  private comment(answer: string, format: TextFormat): [Text, Text] {
    const marker = answer.indexOf("#");
    return marker < 0
      ? [this.parseText(answer.trim(), format), new Text("", format)]
      : [
          this.parseText(answer.slice(0, marker).trim(), format),
          this.parseText(answer.slice(marker + 1).trim(), format),
        ];
  }

  private trueFalseComment(
    answer: string,
    format: TextFormat,
  ): [Text, Text, Text] {
    const bits = answer.split("#", 3);
    return [
      this.parseText((bits[0] ?? "").trim(), format),
      this.parseText((bits[1] ?? "").trim(), format),
      this.parseText((bits[2] ?? "").trim(), format),
    ];
  }

  private answerWeight(answer: string): [number, string] {
    const rest = answer.slice(1);
    const end = rest.indexOf("%");
    return [Number(rest.slice(0, end) || 0) / 100, rest.slice(end + 1)];
  }

  private metadata(comment: string): [string | undefined, string[]] {
    const id = idPattern.exec(comment)?.[1]?.trim().replaceAll("\\]", "]");
    const tags = [...comment.matchAll(tagPattern)]
      .map((match) => (match[1] ?? "").trim().replaceAll("\\]", "]"))
      .filter(Boolean);
    return [id, tags];
  }

  private splitAnswers(text: string, separator: string): string[] {
    const answers = text.split(separator);
    if (answers[0]?.trim() === "") answers.shift();
    return answers;
  }

  private checkCount(minimum: number, answers: string[], text: string) {
    if (answers.length < minimum)
      throw new GiftFormatError(
        `Question must contain at least ${minimum} answer(s)`,
        text,
      );
  }

  readQuestion(lines: string[]): AnyQuestion | undefined {
    let comments = "";
    const body: string[] = [];
    for (const raw of lines) {
      const line = raw.trim();
      if (line.startsWith("//")) {
        comments += `${line}\n`;
        body.push(" ");
      } else body.push(line);
    }
    let text = body.join("\n").trim();
    if (!text) return undefined;
    text = escapePre(text);
    if (text.startsWith("$CATEGORY:"))
      return new Category({ category: text.slice(10).trim() });

    let name: string | undefined;
    if (text.startsWith("::")) {
      text = text.slice(2);
      const end = text.indexOf("::");
      if (end >= 0) {
        name = escapePost(text.slice(0, end)).slice(0, 255);
        text = text.slice(end + 2).trim();
      }
    }
    const start = text.indexOf("{");
    const end = text.indexOf("}");
    let description = false;
    let answerText: string;
    let questionText: string;
    if (start < 0 && end < 0) {
      description = true;
      answerText = "";
      questionText = text;
    } else if (start < 0 || end < 0)
      throw new GiftFormatError("Unbalanced braces", text);
    else {
      answerText = text.slice(start + 1, end).trim();
      questionText = text.endsWith("}")
        ? text.slice(0, start) + text.slice(end + 1)
        : `${text.slice(0, start)}_____${text.slice(end + 1)}`;
    }
    let generalFeedback = "";
    const feedbackMarker = answerText.lastIndexOf("####");
    if (feedbackMarker >= 0) {
      generalFeedback = answerText.slice(feedbackMarker + 4);
      answerText = answerText.slice(0, feedbackMarker).trim();
    }
    const questionTextField = this.parseText(questionText);
    const format = questionTextField.format;
    const [idNumber, tags] = this.metadata(comments);
    const question = this.build(
      this.detectType(answerText, description),
      answerText,
      format,
      text,
    );
    question.name = name ?? defaultQuestionName(questionTextField.text);
    question.questionText = questionTextField;
    question.generalFeedback = this.parseText(generalFeedback, format);
    question.idNumber = idNumber;
    question.tags = tags;
    return question;
  }

  private detectType(answerText: string, description: boolean): string {
    if (description) return "description";
    if (!answerText) return "essay";
    if (answerText[0] === "#") return "numerical";
    if (answerText.includes("~")) return "multichoice";
    if (answerText.includes("=") && answerText.includes("->")) return "match";
    const marker = answerText.indexOf("#");
    const check = (
      marker > 0 ? answerText.slice(0, marker) : answerText
    ).trim();
    return ["T", "TRUE", "F", "FALSE"].includes(check)
      ? "truefalse"
      : "shortanswer";
  }

  private build(
    type: string,
    answerText: string,
    format: TextFormat,
    source: string,
  ): AnyQuestion {
    if (type === "description") return new Description();
    if (type === "essay") return new Essay();
    if (type === "multichoice") {
      const question = new MultiChoice({ single: answerText.includes("=") });
      const answers = this.splitAnswers(answerText.replaceAll("=", "~="), "~");
      this.checkCount(2, answers, source);
      for (let raw of answers) {
        raw = raw.trim();
        let fraction = 0;
        if (raw.startsWith("=")) {
          fraction = 1;
          raw = raw.slice(1);
        } else if (weightPattern.test(raw))
          [fraction, raw] = this.answerWeight(raw);
        const [text, feedback] = this.comment(raw, format);
        question.answers.push(new Answer({ text, fraction, feedback }));
      }
      return question;
    }
    if (type === "match") {
      const question = new Matching();
      const answers = this.splitAnswers(answerText, "=");
      this.checkCount(2, answers, source);
      for (const rawAnswer of answers) {
        const raw = rawAnswer.trim();
        const marker = raw.indexOf("->");
        if (marker < 0)
          throw new GiftFormatError("Matching answer requires '->'", raw);
        question.subquestions.push(
          new Subquestion({
            text: this.parseText(raw.slice(0, marker), format),
            answer: escapePost(raw.slice(marker + 2)).trim(),
          }),
        );
      }
      return question;
    }
    if (type === "truefalse") {
      const [answer, wrong, right] = this.trueFalseComment(answerText, format);
      const correct = ["T", "TRUE"].includes(answer.text);
      return new TrueFalse({
        correct,
        feedbackTrue: correct ? right : wrong,
        feedbackFalse: correct ? wrong : right,
        penalty: 1,
      });
    }
    if (type === "shortanswer") {
      const question = new ShortAnswer();
      const answers = this.splitAnswers(answerText, "=");
      this.checkCount(1, answers, source);
      for (let raw of answers) {
        raw = raw.trim();
        let fraction = 1;
        if (weightPattern.test(raw)) [fraction, raw] = this.answerWeight(raw);
        const [text, feedback] = this.comment(raw, format);
        question.answers.push(
          new Answer({ text: Text.plain(text.text), fraction, feedback }),
        );
      }
      return question;
    }
    if (type === "numerical") {
      const question = new Numerical();
      let answersText = answerText.slice(1);
      let wrongFeedback = "";
      const wrongMarker = answersText.indexOf("~");
      if (wrongMarker >= 0) {
        wrongFeedback = answersText.slice(wrongMarker);
        answersText = answersText.slice(0, wrongMarker);
      }
      const answers = this.splitAnswers(answersText, "=");
      if (!answers.length)
        throw new GiftFormatError("Numerical question has no answers", source);
      for (let raw of answers) {
        raw = raw.trim();
        let fraction = 1;
        if (weightPattern.test(raw)) [fraction, raw] = this.answerWeight(raw);
        const [parsed, feedback] = this.comment(raw, format);
        const value = parsed.text;
        let answer: string;
        let tolerance: string;
        const range = value.indexOf("..");
        const colon = value.indexOf(":");
        if (range > 0) {
          const minimum = Number(value.slice(0, range).trim() || 0);
          const maximum = Number(value.slice(range + 2).trim() || 0);
          const middle = (maximum + minimum) / 2;
          answer = numString(middle);
          tolerance = numString(maximum - middle);
        } else if (colon > 0) {
          answer = value.slice(0, colon).trim();
          tolerance = value.slice(colon + 1).trim();
        } else {
          answer = value.trim();
          tolerance = "0";
        }
        if (!isNumeric(answer)) answer = "*";
        if (!isNumeric(tolerance))
          throw new GiftFormatError(
            "Answer and tolerance must be numeric",
            source,
          );
        question.answers.push(
          new NumericalAnswer({
            text: Text.plain(answer),
            fraction,
            feedback,
            tolerance: Number(tolerance),
          }),
        );
      }
      if (wrongFeedback) {
        const [, feedback] = this.comment(wrongFeedback, format);
        question.answers.push(
          new NumericalAnswer({ text: Text.plain("*"), feedback }),
        );
      }
      return question;
    }
    throw new GiftFormatError(
      `Unsupported GIFT question type ${JSON.stringify(type)}`,
    );
  }
}

export interface GiftWriterOptions {
  strict?: boolean;
}

export class GiftWriter {
  readonly strict: boolean;
  readonly skipped: string[] = [];
  constructor(options: GiftWriterOptions = {}) {
    this.strict = options.strict ?? true;
  }

  dump(quiz: Quiz): string {
    const output: string[] = [];
    for (const question of quiz) {
      try {
        output.push(this.writeQuestion(question));
      } catch (error) {
        if (this.strict) throw error;
        this.skipped.push(
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    return output.join("");
  }

  writeName(name: string): string {
    return `::${escapeGift(name)}::`;
  }
  writeText(value: Text, fallback = TextFormat.Moodle): string {
    const prefix =
      value.text && value.format !== fallback
        ? `[${textFormatToGift(value.format)}]`
        : "";
    return prefix + escapeGift(value.text);
  }
  private generalFeedback(question: Question, indent = "\t"): string {
    const feedback = this.writeText(
      question.generalFeedback,
      question.questionText.format,
    );
    if (!feedback) return "";
    return indent ? `${indent}####${feedback}\n` : `####${feedback}`;
  }
  private metadata(question: AnyQuestion): string {
    if (question instanceof Category) return "";
    const values: string[] = [];
    if (question.idNumber)
      values.push(`[id:${question.idNumber.replaceAll("]", "\\]")}]`);
    values.push(
      ...question.tags.map((tag) => `[tag:${tag.replaceAll("]", "\\]")}]`),
    );
    return values.length ? `// ${values.join(" ")}\n` : "";
  }

  writeQuestion(question: AnyQuestion): string {
    let out = `// question: ${question.id ?? 0}  name: ${question.name}\n${this.metadata(question)}`;
    const format = question.questionText.format;
    if (question instanceof Category)
      out += `$CATEGORY: ${question.category}\n`;
    else if (question instanceof Description)
      out +=
        this.writeName(question.name) + this.writeText(question.questionText);
    else if (question instanceof Essay)
      out +=
        this.writeName(question.name) +
        this.writeText(question.questionText) +
        `{${this.generalFeedback(question, "")}}\n`;
    else if (question instanceof TrueFalse) {
      const right = this.writeText(
        question.correct ? question.feedbackTrue : question.feedbackFalse,
        format,
      );
      const wrong = this.writeText(
        question.correct ? question.feedbackFalse : question.feedbackTrue,
        format,
      );
      out +=
        this.writeName(question.name) +
        this.writeText(question.questionText) +
        `{${escapeGift(question.correct ? "TRUE" : "FALSE")}`;
      if (wrong) out += `#${wrong}`;
      else if (right) out += "#";
      if (right) out += `#${right}`;
      out += `${this.generalFeedback(question, "")}}\n`;
    } else if (question instanceof MultiChoice) {
      out +=
        this.writeName(question.name) +
        this.writeText(question.questionText) +
        "{\n";
      for (const answer of question.answers) {
        const prefix =
          answer.fraction === 1 && question.single
            ? "="
            : answer.fraction === 0
              ? "~"
              : `~%${weight(answer.fraction)}%`;
        out += `\t${prefix}${this.writeText(answer.text, format)}`;
        if (answer.feedback.text)
          out += `#${this.writeText(answer.feedback, format)}`;
        out += "\n";
      }
      out += `${this.generalFeedback(question)}}\n`;
    } else if (question instanceof ShortAnswer) {
      out +=
        this.writeName(question.name) +
        this.writeText(question.questionText) +
        "{\n";
      for (const answer of question.answers)
        out += `\t=%${weight(answer.fraction)}%${escapeGift(answer.text.text)}#${this.writeText(answer.feedback, format)}\n`;
      out += `${this.generalFeedback(question)}}\n`;
    } else if (question instanceof Numerical) {
      out +=
        this.writeName(question.name) +
        this.writeText(question.questionText) +
        "{#\n";
      for (const answer of question.answers) {
        const feedback = this.writeText(answer.feedback, format);
        out += !["", "*"].includes(answer.text.text)
          ? `\t=%${weight(answer.fraction)}%${answer.text.text}:${numString(answer.tolerance || 0)}#${feedback}\n`
          : `\t~#${feedback}\n`;
      }
      out += `${this.generalFeedback(question)}}\n`;
    } else if (question instanceof Matching) {
      out +=
        this.writeName(question.name) +
        this.writeText(question.questionText) +
        "{\n";
      for (const subquestion of question.subquestions)
        out += `\t=${this.writeText(subquestion.text, format)} -> ${escapeGift(subquestion.answer)}\n`;
      out += `${this.generalFeedback(question)}}\n`;
    } else if (question instanceof Cloze || question instanceof Calculated) {
      throw new GiftFormatError(
        `GIFT does not support question type ${JSON.stringify(question.qtype)} (question ${JSON.stringify(question.name)})`,
      );
    } else
      throw new GiftFormatError(
        `GIFT export is not supported for question type ${JSON.stringify((question as AnyQuestion).qtype)}`,
      );
    return `${out}\n`;
  }
}

export function parseGift(source: string, options: ReaderOptions = {}): Quiz {
  return new GiftReader(options).parse(source);
}
export function dumpGift(quiz: Quiz, options: GiftWriterOptions = {}): string {
  return new GiftWriter(options).dump(quiz);
}
export async function readGift(
  file: string | URL,
  options: ReaderOptions = {},
): Promise<Quiz> {
  return parseGift(await readFile(file, "utf8"), options);
}
export function readGiftSync(
  file: string | URL,
  options: ReaderOptions = {},
): Quiz {
  return parseGift(readFileSync(file, "utf8"), options);
}
export async function writeGift(
  quiz: Quiz,
  file: string | URL,
  options: GiftWriterOptions = {},
): Promise<void> {
  await writeFile(file, dumpGift(quiz, options), "utf8");
}
export function writeGiftSync(
  quiz: Quiz,
  file: string | URL,
  options: GiftWriterOptions = {},
): void {
  writeFileSync(file, dumpGift(quiz, options), "utf8");
}
