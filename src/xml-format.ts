// This module is a line-by-line port of Moodle's `qformat_xml` plugin
// (`question/format/xml/format.php`), Copyright 1999 onwards Martin
// Dougiamas (http://moodle.com), licensed under the GNU GPL v3 or later.
// See https://github.com/moodle/moodle/blob/v5.2.2/public/question/format/xml/format.php
//
// This port: Copyright (c) 2026 Brookit.
// Licensed under GPL-3.0-or-later, see LICENSE and README.md.

import { readFile, writeFile } from "node:fs/promises";
import { readFileSync, writeFileSync } from "node:fs";
import { DOMParser } from "@xmldom/xmldom";
import {
  ShowUnits,
  TextFormat,
  textFormatFromXml,
  textFormatToXml,
} from "./enums.js";
import { XmlFormatError } from "./errors.js";
import {
  Answer,
  Calculated,
  CalculatedAnswer,
  CalculatedMulti,
  CalculatedSimple,
  Category,
  Cloze,
  CombinedFeedback,
  DatasetDefinition,
  DatasetItem,
  Description,
  Essay,
  FileAttachment,
  Hint,
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
  Unit,
} from "./model.js";

export interface ReaderOptions {
  strict?: boolean;
}

const childElements = (parent: Element, tag?: string): Element[] => {
  const elements: Element[] = [];
  for (let node = parent.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === 1 && (!tag || (node as Element).tagName === tag))
      elements.push(node as Element);
  }
  return elements;
};
const child = (parent: Element, tag: string): Element | undefined =>
  childElements(parent, tag)[0];
const path = (parent: Element, tags: string): Element | undefined => {
  let current: Element | undefined = parent;
  for (const tag of tags.split("/")) current = current && child(current, tag);
  return current;
};
const textOf = (element: Element | undefined): string =>
  (element?.textContent ?? "").trim();
const numberValue = (value: string, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const optionalNumber = (value: string): number | undefined => {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};
const integerValue = (value: string, fallback: number): number =>
  Math.trunc(numberValue(value, fallback));
const flag = (value: string): boolean =>
  !["", "false", "0"].includes(value.trim());

export class XmlReader {
  readonly strict: boolean;
  readonly errors: string[] = [];

  constructor(options: ReaderOptions = {}) {
    this.strict = options.strict ?? true;
  }

  parse(source: string | Uint8Array): Quiz {
    const xml =
      typeof source === "string" ? source : new TextDecoder().decode(source);
    if (/<!DOCTYPE\b/i.test(xml)) {
      throw new XmlFormatError(
        "DOCTYPE declarations are not allowed in Moodle XML",
      );
    }
    const parserErrors: string[] = [];
    const document = new DOMParser({
      errorHandler(level: string, message: unknown) {
        if (level === "error" || level === "fatalError")
          parserErrors.push(String(message));
      },
    }).parseFromString(xml, "application/xml");
    if (
      parserErrors.length ||
      document.documentElement.tagName === "parsererror"
    ) {
      throw new XmlFormatError(
        `Invalid XML: ${parserErrors[0] ?? textOf(document.documentElement)}`,
      );
    }
    const root = document.documentElement;
    if (root.tagName !== "quiz") {
      throw new XmlFormatError(
        `Expected root element <quiz>, found <${root.tagName}>`,
      );
    }

    const quiz = new Quiz();
    let pendingId: number | undefined;
    for (let node = root.firstChild; node; node = node.nextSibling) {
      if (node.nodeType === 8) {
        const match = /question:\s*(\d+)/.exec(node.nodeValue ?? "");
        pendingId = match?.[1] ? Number(match[1]) : undefined;
        continue;
      }
      if (node.nodeType !== 1 || (node as Element).tagName !== "question")
        continue;
      try {
        const question = this.readQuestion(node as Element);
        if (question) {
          question.id = pendingId;
          quiz.append(question);
        }
      } catch (error) {
        if (this.strict) throw error;
        this.errors.push(
          error instanceof Error ? error.message : String(error),
        );
      }
      pendingId = undefined;
    }
    return quiz;
  }

  readQuestion(element: Element): AnyQuestion | undefined {
    const qtype = (element.getAttribute("type") ?? "").trim();
    switch (qtype) {
      case "category":
        return this.readCategory(element);
      case "multichoice":
        return this.readMultiChoice(element);
      case "truefalse":
        return this.readTrueFalse(element);
      case "shortanswer":
        return this.readShortAnswer(element);
      case "numerical":
        return this.readNumerical(element);
      case "description":
        return this.headers(element, new Description());
      case "match":
      case "matching":
        return this.readMatching(element);
      case "cloze":
      case "multianswer":
        return this.readCloze(element);
      case "essay":
        return this.readEssay(element);
      case "calculated":
      case "calculatedsimple":
      case "calculatedmulti":
        return this.readCalculated(element, qtype);
      default:
        if (this.strict)
          throw new XmlFormatError(
            `Unsupported XML question type: ${JSON.stringify(qtype)}`,
          );
        this.errors.push(
          `Unsupported XML question type: ${JSON.stringify(qtype)}`,
        );
        return undefined;
    }
  }

  private value(parent: Element, tag: string, fallback = ""): string {
    const element = child(parent, tag);
    return element ? textOf(element) : fallback;
  }

  private files(parent: Element): FileAttachment[] {
    return childElements(parent, "file").map((file) =>
      FileAttachment.fromBase64(
        file.getAttribute("name") ?? "",
        textOf(file),
        file.getAttribute("path") ?? "/",
        file.getAttribute("encoding") ?? "base64",
      ),
    );
  }

  private textField(
    parent: Element,
    tag?: string,
    fallback = TextFormat.Html,
  ): Text {
    const element = tag ? child(parent, tag) : parent;
    if (!element) return new Text("", fallback);
    const rawFormat = element.getAttribute("format");
    return new Text(
      textOf(child(element, "text")),
      rawFormat ? textFormatFromXml(rawFormat) : fallback,
      this.files(element),
    );
  }

  private headers<T extends Question>(element: Element, question: T): T {
    question.name = textOf(path(element, "name/text"));
    question.questionText = this.textField(element, "questiontext");
    const format = question.questionText.format;
    question.generalFeedback = this.textField(
      element,
      "generalfeedback",
      format,
    );
    const grade = optionalNumber(this.value(element, "defaultgrade"));
    if (grade !== undefined) question.defaultGrade = grade;
    const penalty = optionalNumber(this.value(element, "penalty"));
    if (penalty !== undefined) {
      question.penalty =
        Math.abs(penalty - 0.3333333) < 0.005 ? 0.3333333 : penalty;
    }
    question.hidden = !["", "0"].includes(this.value(element, "hidden", "0"));
    if (child(element, "idnumber"))
      question.idNumber = this.value(element, "idnumber") || undefined;
    question.tags = childElements(child(element, "tags") ?? element, "tag")
      .filter(() => child(element, "tags") !== undefined)
      .map((tag) => textOf(child(tag, "text")));
    question.courseTags = childElements(
      child(element, "coursetags") ?? element,
      "tag",
    )
      .filter(() => child(element, "coursetags") !== undefined)
      .map((tag) => textOf(child(tag, "text")));
    question.hints = this.hints(element, format);
    return question;
  }

  private hints(element: Element, fallback: TextFormat): Hint[] {
    return childElements(element, "hint").map((hint) => {
      if (child(hint, "hintcontent")) {
        return new Hint({
          text: this.textField(hint, "hintcontent", fallback),
          showNumberCorrect: !["", "0"].includes(
            this.value(hint, "statenumberofcorrectresponses"),
          ),
          clearWrong: !["", "0"].includes(
            this.value(hint, "clearincorrectresponses"),
          ),
          options: this.value(hint, "showfeedbacktoresponses"),
        });
      }
      return new Hint({
        text: this.textField(hint, undefined, fallback),
        showNumberCorrect: Boolean(child(hint, "shownumcorrect")),
        clearWrong: Boolean(child(hint, "clearwrong")),
        options: this.value(hint, "options"),
      });
    });
  }

  private combinedFeedback(
    element: Element,
    fallback: TextFormat,
    includeShow = true,
  ): CombinedFeedback {
    const feedback = new CombinedFeedback({
      correct: this.textField(element, "correctfeedback", fallback),
      partiallyCorrect: this.textField(
        element,
        "partiallycorrectfeedback",
        fallback,
      ),
      incorrect: this.textField(element, "incorrectfeedback", fallback),
    });
    if (includeShow) {
      feedback.showNumberCorrect = Boolean(child(element, "shownumcorrect"));
      if (child(element, "correctresponsesfeedback")) {
        feedback.showNumberCorrect = flag(
          this.value(element, "correctresponsesfeedback", "1"),
        );
      }
    }
    return feedback;
  }

  private answer(
    element: Element,
    withFiles: boolean,
    fallback: TextFormat,
  ): Answer {
    return new Answer({
      text: withFiles
        ? this.textField(element, undefined, fallback)
        : Text.plain(textOf(child(element, "text"))),
      fraction: numberValue(element.getAttribute("fraction") ?? "0", 0) / 100,
      feedback: this.textField(element, "feedback", fallback),
    });
  }

  private readCategory(element: Element): Category {
    const info = child(element, "info");
    return new Category({
      category: textOf(path(element, "category/text")),
      info: info
        ? new Text(
            textOf(child(info, "text")),
            info.getAttribute("format")
              ? textFormatFromXml(info.getAttribute("format"))
              : TextFormat.Moodle,
          )
        : Text.moodle(),
      idNumber: this.value(element, "idnumber") || undefined,
    });
  }

  private readMultiChoice(element: Element): MultiChoice {
    const question = this.headers(element, new MultiChoice());
    const format = question.questionText.format;
    question.single = flag(this.value(element, "single", "true"));
    question.shuffleAnswers = flag(
      this.value(element, "shuffleanswers", "false"),
    );
    question.answerNumbering =
      this.value(element, "answernumbering", "abc") || "abc";
    question.showStandardInstruction = flag(
      this.value(element, "showstandardinstruction", "1"),
    );
    question.answers = childElements(element, "answer").map((answer) =>
      this.answer(answer, true, format),
    );
    question.combinedFeedback = this.combinedFeedback(element, format);
    return question;
  }

  private readTrueFalse(element: Element): TrueFalse {
    const question = this.headers(element, new TrueFalse());
    childElements(element, "answer").forEach((answer, index) => {
      let answerText = textOf(child(answer, "text"));
      if (answerText !== "true" && answerText !== "false")
        answerText = index === 0 ? "true" : "false";
      const correct =
        numberValue(answer.getAttribute("fraction") ?? "0", 0) === 100;
      const feedback = this.textField(
        answer,
        "feedback",
        question.questionText.format,
      );
      if (answerText === "true") {
        question.correct = correct;
        question.feedbackTrue = feedback;
      } else {
        question.correct = !correct;
        question.feedbackFalse = feedback;
      }
    });
    return question;
  }

  private readShortAnswer(element: Element): ShortAnswer {
    const question = this.headers(element, new ShortAnswer());
    question.useCase = !["", "0"].includes(this.value(element, "usecase", "0"));
    question.answers = childElements(element, "answer").map((answer) =>
      this.answer(answer, false, question.questionText.format),
    );
    return question;
  }

  private readNumerical(element: Element): Numerical {
    const question = this.headers(element, new Numerical());
    for (const answerElement of childElements(element, "answer")) {
      const base = this.answer(
        answerElement,
        false,
        question.questionText.format,
      );
      const legacy = child(answerElement, "fraction");
      question.answers.push(
        new NumericalAnswer({
          ...base,
          fraction: legacy ? numberValue(textOf(legacy), 0) : base.fraction,
          tolerance: numberValue(
            this.value(answerElement, "tolerance", "0"),
            0,
          ),
        }),
      );
    }
    const units = path(element, "units");
    if (units)
      for (const unit of childElements(units, "unit")) {
        question.units.push(
          new Unit({
            name: this.value(unit, "unit_name"),
            multiplier: numberValue(this.value(unit, "multiplier", "1"), 1),
          }),
        );
      }
    question.unitGradingType = integerValue(
      this.value(element, "unitgradingtype"),
      0,
    );
    question.unitPenalty = numberValue(this.value(element, "unitpenalty"), 0.1);
    question.unitsLeft = !["", "0"].includes(
      this.value(element, "unitsleft", "0"),
    );
    const rawShowUnits = optionalNumber(this.value(element, "showunits"));
    question.showUnits =
      rawShowUnits ??
      (question.units.length ? ShowUnits.TextInput : ShowUnits.None);
    if (child(element, "instructions"))
      question.instructions = this.textField(
        element,
        "instructions",
        question.questionText.format,
      );
    return question;
  }

  private readMatching(element: Element): Matching {
    const question = this.headers(element, new Matching());
    question.shuffleAnswers = flag(this.value(element, "shuffleanswers", "1"));
    question.subquestions = childElements(element, "subquestion").map(
      (subquestion) =>
        new Subquestion({
          text: this.textField(
            subquestion,
            undefined,
            question.questionText.format,
          ),
          answer: textOf(path(subquestion, "answer/text")),
        }),
    );
    question.combinedFeedback = this.combinedFeedback(
      element,
      question.questionText.format,
    );
    return question;
  }

  private readCloze(element: Element): Cloze {
    const question = this.headers(element, new Cloze());
    if (!question.name)
      question.name = defaultQuestionName(question.questionText.text);
    return question;
  }

  private readEssay(element: Element): Essay {
    const question = this.headers(element, new Essay());
    question.responseFormat =
      this.value(element, "responseformat", "editor") || "editor";
    question.responseFieldLines =
      integerValue(this.value(element, "responsefieldlines"), 15) || 15;
    question.responseRequired = !["", "0"].includes(
      this.value(element, "responserequired", "1"),
    );
    question.minWordLimit = optionalNumber(this.value(element, "minwordlimit"));
    question.maxWordLimit = optionalNumber(this.value(element, "maxwordlimit"));
    question.attachments = integerValue(this.value(element, "attachments"), 0);
    question.attachmentsRequired = integerValue(
      this.value(element, "attachmentsrequired"),
      0,
    );
    question.fileTypesList = this.value(element, "filetypeslist") || undefined;
    question.maxBytes = optionalNumber(this.value(element, "maxbytes"));
    question.graderInfo = this.textField(
      element,
      "graderinfo",
      question.questionText.format,
    );
    question.responseTemplate = this.textField(
      element,
      "responsetemplate",
      question.questionText.format,
    );
    return question;
  }

  private readCalculated(
    element: Element,
    qtype: string,
  ): Calculated<"calculated"> | CalculatedSimple | CalculatedMulti {
    const question = this.headers(
      element,
      qtype === "calculatedsimple"
        ? new CalculatedSimple()
        : qtype === "calculatedmulti"
          ? new CalculatedMulti()
          : new Calculated(),
    );
    const format = question.questionText.format;
    question.synchronize = integerValue(this.value(element, "synchronize"), 0);
    question.single = flag(this.value(element, "single", "true"));
    question.shuffleAnswers = flag(
      this.value(element, "shuffleanswers", "false"),
    );
    question.answerNumbering =
      this.value(element, "answernumbering", "abc") || "abc";
    question.combinedFeedback = this.combinedFeedback(element, format, false);
    for (const answerElement of childElements(element, "answer")) {
      const base = this.answer(answerElement, true, format);
      if (!base.text.text) base.text.text = "*";
      if (qtype === "calculatedmulti") {
        base.text.format = answerElement.getAttribute("format")
          ? textFormatFromXml(answerElement.getAttribute("format"))
          : TextFormat.Plain;
      }
      const legacy = child(answerElement, "fraction");
      question.answers.push(
        new CalculatedAnswer({
          text: base.text,
          feedback: base.feedback,
          fraction: legacy ? numberValue(textOf(legacy), 0) : base.fraction,
          tolerance: numberValue(
            this.value(answerElement, "tolerance", "0"),
            0,
          ),
          toleranceType: integerValue(
            this.value(answerElement, "tolerancetype", "1"),
            1,
          ),
          correctAnswerFormat: integerValue(
            this.value(answerElement, "correctanswerformat", "1"),
            1,
          ),
          correctAnswerLength: integerValue(
            this.value(answerElement, "correctanswerlength", "2"),
            2,
          ),
        }),
      );
    }
    const units = child(element, "units");
    if (units)
      for (const unit of childElements(units, "unit")) {
        question.units.push(
          new Unit({
            name: this.value(unit, "unit_name"),
            multiplier: numberValue(this.value(unit, "multiplier", "1"), 1),
          }),
        );
      }
    question.unitGradingType = integerValue(
      this.value(element, "unitgradingtype"),
      0,
    );
    question.unitPenalty = optionalNumber(this.value(element, "unitpenalty"));
    question.showUnits = integerValue(this.value(element, "showunits"), 0);
    question.unitsLeft = !["", "0"].includes(
      this.value(element, "unitsleft", "0"),
    );
    if (child(element, "instructions"))
      question.instructions = this.textField(element, "instructions", format);
    const definitions = child(element, "dataset_definitions");
    if (definitions)
      for (const definitionElement of childElements(
        definitions,
        "dataset_definition",
      )) {
        const definition = new DatasetDefinition({
          status: textOf(path(definitionElement, "status/text")),
          name: textOf(path(definitionElement, "name/text")),
          type: this.value(definitionElement, "type", "calculated"),
          distribution: textOf(path(definitionElement, "distribution/text")),
          minimum: textOf(path(definitionElement, "minimum/text")),
          maximum: textOf(path(definitionElement, "maximum/text")),
          decimals: textOf(path(definitionElement, "decimals/text")),
          itemCount: integerValue(
            this.value(definitionElement, "itemcount"),
            0,
          ),
        });
        const items = child(definitionElement, "dataset_items");
        if (items)
          definition.items = childElements(items, "dataset_item").map(
            (item) =>
              new DatasetItem({
                number: integerValue(this.value(item, "number"), 0),
                value: this.value(item, "value"),
              }),
          );
        question.datasetDefinitions.push(definition);
      }
    return question;
  }
}

export function defaultQuestionName(
  questionText: string,
  maxLength = 80,
): string {
  const plain = (questionText || "")
    .replace(/<[^>]*>/g, "")
    .trim()
    .replace(/\s+/g, " ");
  if (!plain) return "Question";
  return plain.length <= maxLength
    ? plain
    : `${plain.slice(0, maxLength - 3).trimEnd()}...`;
}

const escapeXml = (value: unknown): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const xmlText = (value: unknown): string => {
  const text = String(value ?? "");
  return text && /[&<>\"]/.test(text) && !text.includes("]]>")
    ? `<![CDATA[${text}]]>`
    : escapeXml(text);
};
const num = (value: number | boolean | undefined): string => {
  if (value === undefined) return "";
  if (typeof value === "boolean") return value ? "1" : "0";
  return Number(value.toFixed(7)).toString();
};

class XmlBuilder {
  readonly lines: string[] = [];
  line(level: number, value: string) {
    this.lines.push(`${"  ".repeat(level)}${value}`);
  }
  leaf(level: number, tag: string, value: unknown) {
    const content = xmlText(value);
    this.line(level, content ? `<${tag}>${content}</${tag}>` : `<${tag}/>`);
  }
  textField(level: number, tag: string, value: Text, withFormat = true) {
    const attr = withFormat ? ` format="${textFormatToXml(value.format)}"` : "";
    this.line(level, `<${tag}${attr}>`);
    this.leaf(level + 1, "text", value.text);
    for (const file of value.files) {
      this.line(
        level + 1,
        `<file name="${escapeXml(file.name)}" path="${escapeXml(file.path)}" encoding="${escapeXml(file.encoding)}">${file.base64}</file>`,
      );
    }
    this.line(level, `</${tag}>`);
  }
}

export class XmlWriter {
  dump(quiz: Quiz): string {
    const out = new XmlBuilder();
    out.lines.push('<?xml version="1.0" encoding="UTF-8"?>', "<quiz>");
    for (const question of quiz) {
      if (question.id !== undefined)
        out.line(1, `<!-- question: ${question.id}  -->`);
      this.question(out, question);
    }
    out.lines.push("</quiz>");
    return `${out.lines.join("\n")}\n`;
  }

  private files(out: XmlBuilder, level: number, files: FileAttachment[]) {
    for (const file of files)
      out.line(
        level,
        `<file name="${escapeXml(file.name)}" path="${escapeXml(file.path)}" encoding="${escapeXml(file.encoding)}">${file.base64}</file>`,
      );
  }
  private answer(
    out: XmlBuilder,
    level: number,
    answer: Answer,
    withFormat = true,
  ) {
    const format = withFormat
      ? ` format="${textFormatToXml(answer.text.format)}"`
      : "";
    out.line(level, `<answer fraction="${num(answer.percent)}"${format}>`);
    out.leaf(level + 1, "text", answer.text.text);
    this.files(out, level + 1, answer.text.files);
    out.textField(level + 1, "feedback", answer.feedback);
    out.line(level, "</answer>");
  }
  private combined(
    out: XmlBuilder,
    level: number,
    value: CombinedFeedback,
    includeShow = true,
  ) {
    out.textField(level, "correctfeedback", value.correct);
    out.textField(level, "partiallycorrectfeedback", value.partiallyCorrect);
    out.textField(level, "incorrectfeedback", value.incorrect);
    if (includeShow && value.showNumberCorrect)
      out.line(level, "<shownumcorrect/>");
  }
  private units(out: XmlBuilder, level: number, units: Unit[]) {
    if (!units.length) return;
    out.line(level, "<units>");
    for (const unit of units) {
      out.line(level + 1, "<unit>");
      out.leaf(level + 2, "multiplier", num(unit.multiplier));
      out.leaf(level + 2, "unit_name", unit.name);
      out.line(level + 1, "</unit>");
    }
    out.line(level, "</units>");
  }

  private question(out: XmlBuilder, question: AnyQuestion) {
    if (question instanceof Category) {
      out.line(1, '<question type="category">');
      out.line(2, "<category>");
      out.leaf(3, "text", question.category);
      out.line(2, "</category>");
      out.textField(2, "info", question.info);
      out.leaf(2, "idnumber", question.idNumber ?? "");
      out.line(1, "</question>");
      return;
    }
    const qtype =
      question instanceof Matching
        ? "matching"
        : question instanceof Cloze
          ? "cloze"
          : question.qtype;
    out.line(1, `<question type="${qtype}">`);
    out.line(2, "<name>");
    out.leaf(3, "text", question.name);
    out.line(2, "</name>");
    out.textField(2, "questiontext", question.questionText);
    out.textField(2, "generalfeedback", question.generalFeedback);
    if (!(question instanceof Cloze))
      out.leaf(2, "defaultgrade", num(question.defaultGrade));
    out.leaf(2, "penalty", num(question.penalty));
    out.leaf(2, "hidden", question.hidden ? "1" : "0");
    out.leaf(2, "idnumber", question.idNumber ?? "");
    this.body(out, question);
    for (const hint of question.hints) {
      out.line(2, `<hint format="${textFormatToXml(hint.text.format)}">`);
      out.leaf(3, "text", hint.text.text);
      if (hint.showNumberCorrect) out.line(3, "<shownumcorrect/>");
      if (hint.clearWrong) out.line(3, "<clearwrong/>");
      if (hint.options) out.leaf(3, "options", hint.options);
      this.files(out, 3, hint.text.files);
      out.line(2, "</hint>");
    }
    for (const [tag, values] of [
      ["coursetags", question.courseTags],
      ["tags", question.tags],
    ] as const) {
      if (!values.length) continue;
      out.line(2, `<${tag}>`);
      for (const value of values) {
        out.line(3, "<tag>");
        out.leaf(4, "text", value);
        out.line(3, "</tag>");
      }
      out.line(2, `</${tag}>`);
    }
    out.line(1, "</question>");
  }

  private body(out: XmlBuilder, question: Exclude<AnyQuestion, Category>) {
    if (question instanceof Description || question instanceof Cloze) return;
    if (question instanceof TrueFalse) {
      for (const answer of question.answers) this.answer(out, 2, answer);
      return;
    }
    if (question instanceof MultiChoice) {
      out.leaf(2, "single", question.single ? "true" : "false");
      out.leaf(2, "shuffleanswers", question.shuffleAnswers ? "true" : "false");
      out.leaf(2, "answernumbering", question.answerNumbering);
      out.leaf(
        2,
        "showstandardinstruction",
        question.showStandardInstruction ? "1" : "0",
      );
      this.combined(out, 2, question.combinedFeedback);
      for (const answer of question.answers) this.answer(out, 2, answer);
      return;
    }
    if (question instanceof ShortAnswer) {
      out.leaf(2, "usecase", question.useCase ? "1" : "0");
      for (const answer of question.answers) this.answer(out, 2, answer);
      return;
    }
    if (question instanceof Numerical) {
      for (const answer of question.answers) {
        this.answer(out, 2, answer);
        const close = out.lines.pop()!;
        out.leaf(3, "tolerance", num(answer.tolerance));
        out.lines.push(close);
      }
      this.units(out, 2, question.units);
      out.leaf(2, "unitgradingtype", question.unitGradingType);
      out.leaf(2, "unitpenalty", num(question.unitPenalty));
      out.leaf(2, "showunits", question.showUnits);
      out.leaf(2, "unitsleft", question.unitsLeft ? "1" : "0");
      if (question.instructions.text)
        out.textField(2, "instructions", question.instructions);
      return;
    }
    if (question instanceof Matching) {
      out.leaf(2, "shuffleanswers", question.shuffleAnswers ? "true" : "false");
      this.combined(out, 2, question.combinedFeedback);
      for (const sub of question.subquestions) {
        out.line(
          2,
          `<subquestion format="${textFormatToXml(sub.text.format)}">`,
        );
        out.leaf(3, "text", sub.text.text);
        this.files(out, 3, sub.text.files);
        out.line(3, "<answer>");
        out.leaf(4, "text", sub.answer);
        out.line(3, "</answer>");
        out.line(2, "</subquestion>");
      }
      return;
    }
    if (question instanceof Essay) {
      out.leaf(2, "responseformat", question.responseFormat);
      out.leaf(2, "responserequired", question.responseRequired ? "1" : "0");
      out.leaf(2, "responsefieldlines", question.responseFieldLines);
      out.leaf(2, "minwordlimit", question.minWordLimit ?? "");
      out.leaf(2, "maxwordlimit", question.maxWordLimit ?? "");
      out.leaf(2, "attachments", question.attachments);
      out.leaf(2, "attachmentsrequired", question.attachmentsRequired);
      out.leaf(2, "maxbytes", question.maxBytes ?? "");
      out.leaf(2, "filetypeslist", question.fileTypesList ?? "");
      out.textField(2, "graderinfo", question.graderInfo);
      out.textField(2, "responsetemplate", question.responseTemplate);
      return;
    }
    if (question instanceof Calculated) {
      out.leaf(2, "synchronize", question.synchronize);
      out.leaf(2, "single", question.single ? "1" : "0");
      out.leaf(2, "answernumbering", question.answerNumbering);
      out.leaf(2, "shuffleanswers", question.shuffleAnswers ? "1" : "0");
      this.combined(out, 2, question.combinedFeedback, false);
      const multi = question instanceof CalculatedMulti;
      for (const answer of question.answers) {
        this.answer(out, 2, answer, multi);
        const close = out.lines.pop()!;
        out.leaf(3, "tolerance", num(answer.tolerance));
        out.leaf(3, "tolerancetype", answer.toleranceType);
        out.leaf(3, "correctanswerformat", answer.correctAnswerFormat);
        out.leaf(3, "correctanswerlength", answer.correctAnswerLength);
        out.lines.push(close);
      }
      out.leaf(2, "unitgradingtype", question.unitGradingType);
      if (question.unitPenalty !== undefined)
        out.leaf(2, "unitpenalty", num(question.unitPenalty));
      out.leaf(2, "showunits", question.showUnits);
      out.leaf(2, "unitsleft", question.unitsLeft ? "1" : "0");
      if (question.instructions.text)
        out.textField(2, "instructions", question.instructions);
      this.units(out, 2, question.units);
      if (question.datasetDefinitions.length) {
        out.line(2, "<dataset_definitions>");
        for (const definition of question.datasetDefinitions) {
          out.line(3, "<dataset_definition>");
          for (const [tag, value] of [
            ["status", definition.status],
            ["name", definition.name],
          ] as const) {
            out.line(4, `<${tag}>`);
            out.leaf(5, "text", value);
            out.line(4, `</${tag}>`);
          }
          out.leaf(4, "type", definition.type);
          for (const [tag, value] of [
            ["distribution", definition.distribution],
            ["minimum", definition.minimum],
            ["maximum", definition.maximum],
            ["decimals", definition.decimals],
          ] as const) {
            out.line(4, `<${tag}>`);
            out.leaf(5, "text", value);
            out.line(4, `</${tag}>`);
          }
          out.leaf(4, "itemcount", definition.itemCount);
          if (definition.items.length) {
            out.line(4, "<dataset_items>");
            for (const item of definition.items) {
              out.line(5, "<dataset_item>");
              out.leaf(6, "number", item.number);
              out.leaf(6, "value", item.value);
              out.line(5, "</dataset_item>");
            }
            out.line(4, "</dataset_items>");
            out.leaf(4, "number_of_items", definition.numberOfItems);
          }
          out.line(3, "</dataset_definition>");
        }
        out.line(2, "</dataset_definitions>");
      }
      return;
    }
    throw new XmlFormatError(
      "XML export is not supported for this question object",
    );
  }
}

export function parseXml(
  source: string | Uint8Array,
  options: ReaderOptions = {},
): Quiz {
  return new XmlReader(options).parse(source);
}
export function dumpXml(quiz: Quiz): string {
  return new XmlWriter().dump(quiz);
}
export async function readXml(
  file: string | URL,
  options: ReaderOptions = {},
): Promise<Quiz> {
  return parseXml(await readFile(file), options);
}
export function readXmlSync(
  file: string | URL,
  options: ReaderOptions = {},
): Quiz {
  return parseXml(readFileSync(file), options);
}
export async function writeXml(quiz: Quiz, file: string | URL): Promise<void> {
  await writeFile(file, dumpXml(quiz), "utf8");
}
export function writeXmlSync(quiz: Quiz, file: string | URL): void {
  writeFileSync(file, dumpXml(quiz), "utf8");
}
