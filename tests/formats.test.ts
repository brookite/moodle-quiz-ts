import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  Answer,
  Calculated,
  Category,
  Cloze,
  Description,
  GiftFormatError,
  GiftReader,
  GiftWriter,
  Matching,
  MultiChoice,
  Numerical,
  Quiz,
  ShortAnswer,
  Text,
  TextFormat,
  TrueFalse,
  dumpGift,
  dumpXml,
  escapeGift,
  escapePost,
  escapePre,
  parseGift,
  parseXml,
} from "../src/index.js";

const example = (name: string) =>
  readFileSync(
    fileURLToPath(
      new URL(`../../pymdl_quiz/examples/${name}`, import.meta.url),
    ),
    "utf8",
  );

describe("GIFT reader", () => {
  it("reads multiple choice and feedback", () => {
    const question = parseGift(
      "::Имя::Кто?{~Грант ~Джефферсон =никто #Верно}",
    ).at(0);
    expect(question).toBeInstanceOf(MultiChoice);
    const multi = question as MultiChoice;
    expect([multi.name, multi.questionText.text, multi.single]).toEqual([
      "Имя",
      "Кто?",
      true,
    ]);
    expect(
      multi.answers.map((answer) => [answer.text.text, answer.fraction]),
    ).toEqual([
      ["Грант", 0],
      ["Джефферсон", 0],
      ["никто", 1],
    ]);
    expect(multi.answers[2]?.feedback.text).toBe("Верно");
  });

  it("reads weighted multiple answers", () => {
    const question = parseGift("Какие простые?{~%50%2 ~%50%3 ~%-100%4}").at(
      0,
    ) as MultiChoice;
    expect(question.single).toBe(false);
    expect(question.answers.map((answer) => answer.fraction)).toEqual([
      0.5, 0.5, -1,
    ]);
  });

  it("handles missing words, true/false and formats", () => {
    expect(
      parseGift("Грант {~похоронен =погребён} в гробнице.").at(0)?.questionText
        .text,
    ).toContain("_____");
    const tf = parseGift("Земля круглая.{FALSE#Неверный#Верный}").at(
      0,
    ) as TrueFalse;
    expect([
      tf.correct,
      tf.feedbackFalse.text,
      tf.feedbackTrue.text,
      tf.penalty,
    ]).toEqual([false, "Верный", "Неверный", 1]);
    const html = parseGift("::Имя::[html]<p>Текст</p>{=да}").at(0)!;
    expect([html.questionText.format, html.questionText.text]).toEqual([
      TextFormat.Html,
      "<p>Текст</p>",
    ]);
  });

  it("reads short, numerical and matching answers", () => {
    const short = parseGift("Кто?{=%100%никто #ага =%50%Грант}").at(
      0,
    ) as ShortAnswer;
    expect(
      short.answers.map((answer) => [answer.text.text, answer.fraction]),
    ).toEqual([
      ["никто", 1],
      ["Грант", 0.5],
    ]);
    const [exact, ranged, single] = parseGift(
      "Год?{#1822:5}\n\nСколько?{#3..5}\n\nТочно?{#42}",
    ).questions as Numerical[];
    expect([
      exact!.answers[0]?.text.text,
      exact!.answers[0]?.tolerance,
    ]).toEqual(["1822", 5]);
    expect([
      ranged!.answers[0]?.text.text,
      ranged!.answers[0]?.tolerance,
    ]).toEqual(["4", 1]);
    expect(single!.answers[0]?.tolerance).toBe(0);
    const matching = parseGift(
      "Сопоставьте.{=Канада -> Оттава =Италия -> Рим}",
    ).at(0) as Matching;
    expect(
      matching.subquestions.map((item) => [item.text.text, item.answer]),
    ).toEqual([
      ["Канада", "Оттава"],
      ["Италия", "Рим"],
    ]);
  });

  it("reads metadata, categories, essay and description", () => {
    const quiz = parseGift(
      "$CATEGORY: A\n\n// [id:q-1] [tag:алгебра]\nВопрос?{=да}\n\nЭссе.{}\n\nОписание.",
    );
    expect(quiz.at(0)).toBeInstanceOf(Category);
    expect([quiz.at(1)?.idNumber, quiz.at(1)?.tags]).toEqual([
      "q-1",
      ["алгебра"],
    ]);
    expect(quiz.at(2)?.qtype).toBe("essay");
    expect(quiz.at(3)).toBeInstanceOf(Description);
  });

  it("supports strict and tolerant errors", () => {
    expect(() => parseGift("Плохой {=да")).toThrow(GiftFormatError);
    const reader = new GiftReader({ strict: false });
    expect(reader.parse("Плохой {=да\n\nХороший?{=да}").length).toBe(1);
    expect(reader.errors).toHaveLength(1);
  });

  it("round-trips escaping and the complete sample", () => {
    expect(escapePost(escapePre(String.raw`a\=b\#c`))).toBe("a=b#c");
    expect(escapeGift("a=b#c\nd")).toBe(String.raw`a\=b\#c\nd`);
    const before = parseGift(example("sample.gift"));
    const after = parseGift(dumpGift(before));
    expect(after.questions.map((q) => q.qtype)).toEqual(
      before.questions.map((q) => q.qtype),
    );
    expect(after.questions.map((q) => q.name)).toEqual(
      before.questions.map((q) => q.name),
    );
  });

  it("rejects or skips unsupported output types", () => {
    const quiz = new Quiz([
      new Cloze({ name: "c", questionText: Text.html("{1:SHORTANSWER:=да}") }),
    ]);
    expect(() => dumpGift(quiz)).toThrow(GiftFormatError);
    const writer = new GiftWriter({ strict: false });
    expect(writer.dump(quiz)).toBe("");
    expect(writer.skipped).toHaveLength(1);
  });
});

describe("Moodle XML", () => {
  it("reads every supported sample type", () => {
    expect(
      parseXml(example("sample.xml")).questions.map((q) => q.qtype),
    ).toEqual([
      "category",
      "multichoice",
      "truefalse",
      "shortanswer",
      "numerical",
      "match",
      "essay",
      "description",
      "multianswer",
      "calculated",
    ]);
  });

  it("rejects malformed XML and document type declarations", () => {
    expect(() => parseXml("<quiz><question></quiz>")).toThrow();
    expect(() =>
      parseXml(
        '<!DOCTYPE quiz SYSTEM "https://example.invalid/test.dtd"><quiz/>',
      ),
    ).toThrow("DOCTYPE");
  });

  it("reads headers, hints, units and calculated datasets", () => {
    const quiz = parseXml(example("sample.xml"));
    const multi = quiz.at(1) as MultiChoice;
    expect([
      multi.id,
      multi.idNumber,
      multi.tags,
      multi.combinedFeedback.showNumberCorrect,
    ]).toEqual([101, "capital-1", ["география"], true]);
    expect(multi.hints.map((hint) => hint.text.text)).toEqual([
      "Подумайте о Сене.",
      "Эйфелева башня.",
    ]);
    const numerical = quiz.at(4) as Numerical;
    expect([numerical.answers[0]?.tolerance, numerical.units[0]?.name]).toEqual(
      [500, "км/с"],
    );
    const calculated = quiz.at(9) as Calculated;
    expect(calculated.datasetDefinitions.map((item) => item.name)).toEqual([
      "a",
      "b",
    ]);
    expect(
      calculated.datasetDefinitions[0]?.items.map((item) => item.value),
    ).toEqual(["3.0", "5.0"]);
  });

  it("is idempotent and preserves CDATA-sensitive content", () => {
    const once = dumpXml(parseXml(example("sample.xml")));
    expect(dumpXml(parseXml(once))).toBe(once);
    const quiz = new Quiz([
      new ShortAnswer({
        name: "A & B",
        questionText: Text.html("<p>Текст</p>"),
        answers: [
          new Answer({ text: Text.plain("простой текст"), fraction: 1 }),
        ],
      }),
    ]);
    const output = dumpXml(quiz);
    expect(output).toContain("<![CDATA[<p>Текст</p>]]>");
    expect(output).toContain("<![CDATA[A & B]]>");
  });

  it("round-trips files and CDATA terminators", () => {
    const source = `<quiz><question type="description"><name><text>x</text></name><questiontext format="html"><text><![CDATA[<p>]]></text><file name="a.txt" path="/" encoding="base64">0L/RgNC40LLQtdGC</file></questiontext></question></quiz>`;
    const quiz = parseXml(source);
    expect(
      Buffer.from(quiz.at(0)!.questionText.files[0]!.content).toString(),
    ).toBe("привет");
    expect(parseXml(dumpXml(quiz)).at(0)!.questionText.files[0]!.base64).toBe(
      "0L/RgNC40LLQtdGC",
    );
    const dangerous = new Quiz([
      new Description({
        questionText: Text.html("<p>Внутри ]]> и <b>тег</b></p>"),
      }),
    ]);
    expect(parseXml(dumpXml(dangerous)).at(0)?.questionText.text).toContain(
      "]]>",
    );
  });

  it("omits default grade for cloze and crosses formats", () => {
    const source = parseGift(example("sample.gift"));
    const throughXml = parseXml(dumpXml(source));
    expect(throughXml.questions.map((q) => q.qtype)).toEqual(
      source.questions.map((q) => q.qtype),
    );
    expect(dumpXml(new Quiz([new Cloze()]))).not.toContain("defaultgrade");
    expect(
      new Quiz([
        new Category({ category: "A" }),
        new ShortAnswer({ name: "Q" }),
      ])
        .byCategory()
        .map(([name, items]) => [name, items.length]),
    ).toEqual([["A", 1]]);
  });
});
