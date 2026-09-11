# moodle-quiz-ts

A native ESM TypeScript library for reading, editing, and writing Moodle
question banks. Supports **Moodle XML** and **GIFT**, and reproduces the
behavior of Moodle's PHP formatters, which were used as the source for the
Python port in the sibling package.

Requires Node.js 20 or newer.

## Provenance and attribution

This package is a **derivative work** of Moodle, ported from PHP to
TypeScript. The port was produced with the help of LLM coding agents, under
human review, and reproduces the original formatters' behavior (including
several data-loss quirks noted below).

Ported from:

| Module | Ported from (Moodle, pinned at `v5.2.2`) | Original copyright |
|---|---|---|
| `src/xml-format.ts` | [`public/question/format/xml/format.php`](https://github.com/moodle/moodle/blob/v5.2.2/public/question/format/xml/format.php) (`qformat_xml`) | © 1999 onwards Martin Dougiamas ([moodle.com](http://moodle.com)) |
| `src/gift-format.ts` | [`public/question/format/gift/format.php`](https://github.com/moodle/moodle/blob/v5.2.2/public/question/format/gift/format.php) (`qformat_gift`) | © 2003 Paul Tsuchido Shew |

Upstream project: https://github.com/moodle/moodle — licensed under the GNU
General Public License, version 3 or later.

Because this is a derivative work, it is licensed under the same terms —
see [License](#license) below.

## Features

| Question type                                                                             |   Moodle XML    |      GIFT       |
| --------------------------------------------------------------------------------------- | :-------------: | :-------------: |
| `multichoice`, `truefalse`, `shortanswer`, `numerical`, `match`, `essay`, `description` | read + write | read + write |
| `multianswer` (cloze)                                                                   | read + write |        —        |
| `calculated`, `calculatedsimple`, `calculatedmulti`                                     | read + write |        —        |
| `category`                                                                              | read + write | read + write |

Also supported: embedded base64 files, hints, combined feedback, tags,
`idnumber`, units, essay fields, calculated-question dataset definitions,
and all Moodle text formats.

## Installation

```sh
npm install moodle-quiz-ts
```

The package publishes an ESM-only API.

## Usage

```ts
import {
  Answer,
  MultiChoice,
  Quiz,
  Text,
  dumpXml,
  readXml,
  writeGift,
} from "moodle-quiz-ts";

const quiz = await readXml("bank.xml");

for (const question of quiz.byType("multichoice")) {
  // question is automatically narrowed to MultiChoice.
  question.shuffleAnswers = true;
}

quiz.append(
  new MultiChoice({
    name: "Capital of France",
    questionText: Text.html("<p>What is the capital of France?</p>"),
    answers: [
      new Answer({ text: Text.html("Paris"), fraction: 1 }),
      new Answer({ text: Text.html("Lyon"), fraction: 0 }),
    ],
  }),
);

await writeGift(quiz, "bank.gift", { strict: false });
console.log(dumpXml(quiz));
```

Parsing and serializing strings does no file I/O:

```ts
import { dumpGift, parseGift, parseXml } from "moodle-quiz-ts";

const quiz = parseXml(xmlSource);
const giftSource = dumpGift(quiz, { strict: false });
const reparsed = parseGift(giftSource);
```

For scripts without `await`, `readXmlSync`, `writeXmlSync`, `readGiftSync`,
and `writeGiftSync` are also exported. The unsuffixed async variants are
preferred for server-side code.

## Model

`Quiz` is an iterable container over a flat list of questions. It exposes
`length`, `at()`, `append()`, `realQuestions()`, a type-safe `byType()`, and
`byCategory()`.

Common question fields use camelCase:

- `questionText`, `generalFeedback`, `defaultGrade`, `idNumber`;
- `shuffleAnswers`, `answerNumbering`, `combinedFeedback`;
- `datasetDefinitions`, `unitGradingType`, `showUnits`.

`Text` combines text, `TextFormat`, and embedded `FileAttachment`s.
Attachment content is stored as `Uint8Array`. `Answer.fraction` is the
grade fraction (`1` means 100%, `0.5` means 50%).

`AnyQuestion` is a discriminated union on the literal `qtype` field, so a
plain `switch (question.qtype)` and `quiz.byType()` give standard
TypeScript type narrowing.

## Errors and tolerant mode

By default the reader/writer is strict and throws `XmlFormatError` or
`GiftFormatError`. In tolerant mode, bad questions are skipped instead:

```ts
import { GiftReader, GiftWriter } from "moodle-quiz-ts";

const reader = new GiftReader({ strict: false });
const quiz = reader.parse(source);
console.warn(reader.errors);

const writer = new GiftWriter({ strict: false });
const gift = writer.dump(quiz);
console.warn(writer.skipped); // e.g. cloze and calculated
```

GIFT export inevitably loses data the format can't represent: attachments,
hints, combined feedback, and units.

## CLI

```sh
npx moodle-quiz convert bank.xml bank.gift
npx moodle-quiz convert bank.gift --to xml
npx moodle-quiz info bank.xml --list
npx moodle-quiz convert bank.xml bank.gift --no-strict
```

The `.xml`, `.gift`, and `.txt` extensions determine the format; `--from`
and `--to` override it.

## Development

```sh
npm install
npm run check
npm test
npm run build
```

## License

This project is a derivative work of Moodle and is licensed under the
**GNU General Public License v3.0 or later (GPL-3.0-or-later)**, the same
license as the original code — see [`LICENSE`](LICENSE).

- Original code: Copyright 1999 onwards Martin Dougiamas and contributors
  (`qformat_xml`), Copyright 2003 Paul Tsuchido Shew (`qformat_gift`),
  part of [Moodle](https://github.com/moodle/moodle).
- This port: Copyright (c) 2026 Brookit.

Any software that incorporates or links against this package and is
distributed must comply with the terms of the GPL.
