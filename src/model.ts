import { ShowUnits, TextFormat, ToleranceType } from "./enums.js";

type MutableOptions<T, K extends keyof T = never> = Partial<Omit<T, K>>;

export class FileAttachment {
  name = "";
  content: Uint8Array = new Uint8Array();
  path = "/";
  encoding = "base64";

  constructor(options: MutableOptions<FileAttachment> = {}) {
    Object.assign(this, options);
  }

  get base64(): string {
    return Buffer.from(this.content).toString("base64");
  }

  get fullPath(): string {
    return `${this.path}${this.name}`;
  }

  static fromBase64(
    name: string,
    data: string,
    path = "/",
    encoding = "base64",
  ) {
    return new FileAttachment({
      name,
      content: Buffer.from(data || "", "base64"),
      path,
      encoding,
    });
  }
}

export class Text {
  text = "";
  format = TextFormat.Html;
  files: FileAttachment[] = [];

  constructor(
    text = "",
    format = TextFormat.Html,
    files: FileAttachment[] = [],
  ) {
    this.text = text;
    this.format = format;
    this.files = files;
  }

  static html(text = "") {
    return new Text(text, TextFormat.Html);
  }
  static plain(text = "") {
    return new Text(text, TextFormat.Plain);
  }
  static moodle(text = "") {
    return new Text(text, TextFormat.Moodle);
  }
}

export class Answer {
  text = Text.html();
  /** Fraction of the grade, where 1 is 100%. */
  fraction = 0;
  feedback = Text.html();
  id: number | undefined;

  constructor(options: MutableOptions<Answer> = {}) {
    Object.assign(this, options);
  }
  get percent(): number {
    return this.fraction * 100;
  }
}

export class NumericalAnswer extends Answer {
  tolerance = 0;
  constructor(options: MutableOptions<NumericalAnswer> = {}) {
    super(options);
    Object.assign(this, options);
  }
}

export class CalculatedAnswer extends NumericalAnswer {
  toleranceType: ToleranceType | number = ToleranceType.Relative;
  correctAnswerFormat = 1;
  correctAnswerLength = 2;
  constructor(options: MutableOptions<CalculatedAnswer> = {}) {
    super(options);
    Object.assign(this, options);
  }
}

export class Unit {
  name = "";
  multiplier = 1;
  constructor(options: MutableOptions<Unit> = {}) {
    Object.assign(this, options);
  }
}

export class Subquestion {
  text = Text.html();
  answer = "";
  constructor(options: MutableOptions<Subquestion> = {}) {
    Object.assign(this, options);
  }
}

export class Hint {
  text = Text.html();
  showNumberCorrect = false;
  clearWrong = false;
  options = "";
  constructor(options: MutableOptions<Hint> = {}) {
    Object.assign(this, options);
  }
}

export class CombinedFeedback {
  correct = Text.html();
  partiallyCorrect = Text.html();
  incorrect = Text.html();
  showNumberCorrect = false;
  constructor(options: MutableOptions<CombinedFeedback> = {}) {
    Object.assign(this, options);
  }
}

export class DatasetItem {
  number = 0;
  value = "";
  constructor(options: MutableOptions<DatasetItem> = {}) {
    Object.assign(this, options);
  }
}

export class DatasetDefinition {
  name = "";
  type = "calculated";
  status = "private";
  distribution = "uniform";
  minimum = "1.0";
  maximum = "10.0";
  decimals = "1";
  itemCount = 0;
  items: DatasetItem[] = [];
  constructor(options: MutableOptions<DatasetDefinition> = {}) {
    Object.assign(this, options);
  }
  get numberOfItems(): number {
    return this.items.length;
  }
}

export type QuestionType =
  | "category"
  | "description"
  | "essay"
  | "shortanswer"
  | "truefalse"
  | "multichoice"
  | "match"
  | "numerical"
  | "multianswer"
  | "calculated"
  | "calculatedsimple"
  | "calculatedmulti";

export abstract class Question {
  abstract readonly qtype: QuestionType;
  name = "";
  questionText = Text.html();
  generalFeedback = Text.html();
  defaultGrade = 1;
  penalty = 0.3333333;
  hidden = false;
  idNumber: string | undefined;
  tags: string[] = [];
  courseTags: string[] = [];
  hints: Hint[] = [];
  id: number | undefined;

  protected constructor(options: MutableOptions<Question, "qtype"> = {}) {
    Object.assign(this, options);
  }
}

export class Category extends Question {
  readonly qtype = "category" as const;
  category = "";
  info = Text.moodle();
  constructor(options: MutableOptions<Category, "qtype"> = {}) {
    super(options);
    Object.assign(this, options);
  }
}

export class Description extends Question {
  readonly qtype = "description" as const;
  override defaultGrade = 0;
  constructor(options: MutableOptions<Description, "qtype"> = {}) {
    super(options);
    Object.assign(this, options);
  }
}

export class Essay extends Question {
  readonly qtype = "essay" as const;
  responseFormat = "editor";
  responseRequired = true;
  responseFieldLines = 15;
  minWordLimit: number | undefined;
  maxWordLimit: number | undefined;
  attachments = 0;
  attachmentsRequired = 0;
  maxBytes: number | undefined;
  fileTypesList: string | undefined;
  graderInfo = Text.html();
  responseTemplate = Text.html();
  constructor(options: MutableOptions<Essay, "qtype"> = {}) {
    super(options);
    Object.assign(this, options);
  }
}

export class ShortAnswer extends Question {
  readonly qtype = "shortanswer" as const;
  useCase = false;
  answers: Answer[] = [];
  constructor(options: MutableOptions<ShortAnswer, "qtype"> = {}) {
    super(options);
    Object.assign(this, options);
  }
}

export class TrueFalse extends Question {
  readonly qtype = "truefalse" as const;
  correct = true;
  feedbackTrue = Text.html();
  feedbackFalse = Text.html();
  constructor(options: MutableOptions<TrueFalse, "qtype" | "answers"> = {}) {
    super(options);
    Object.assign(this, options);
  }
  get answers(): [Answer, Answer] {
    return [
      new Answer({
        text: Text.moodle("true"),
        fraction: Number(this.correct),
        feedback: this.feedbackTrue,
      }),
      new Answer({
        text: Text.moodle("false"),
        fraction: Number(!this.correct),
        feedback: this.feedbackFalse,
      }),
    ];
  }
}

export class MultiChoice extends Question {
  readonly qtype = "multichoice" as const;
  single = true;
  shuffleAnswers = true;
  answerNumbering = "abc";
  showStandardInstruction = false;
  answers: Answer[] = [];
  combinedFeedback = new CombinedFeedback();
  constructor(options: MutableOptions<MultiChoice, "qtype"> = {}) {
    super(options);
    Object.assign(this, options);
  }
}

export class Matching extends Question {
  readonly qtype = "match" as const;
  shuffleAnswers = true;
  subquestions: Subquestion[] = [];
  combinedFeedback = new CombinedFeedback();
  constructor(options: MutableOptions<Matching, "qtype"> = {}) {
    super(options);
    Object.assign(this, options);
  }
}

export class Numerical extends Question {
  readonly qtype = "numerical" as const;
  answers: NumericalAnswer[] = [];
  units: Unit[] = [];
  unitGradingType = 0;
  unitPenalty = 0.1;
  showUnits: ShowUnits | number = ShowUnits.None;
  unitsLeft = false;
  instructions = Text.html();
  constructor(options: MutableOptions<Numerical, "qtype"> = {}) {
    super(options);
    Object.assign(this, options);
  }
}

export class Cloze extends Question {
  readonly qtype = "multianswer" as const;
  constructor(options: MutableOptions<Cloze, "qtype"> = {}) {
    super(options);
    Object.assign(this, options);
  }
}

type CalculatedType = "calculated" | "calculatedsimple" | "calculatedmulti";

export class Calculated<
  T extends CalculatedType = "calculated",
> extends Question {
  readonly qtype: T;
  synchronize = 0;
  single = true;
  shuffleAnswers = false;
  answerNumbering = "abc";
  answers: CalculatedAnswer[] = [];
  combinedFeedback = new CombinedFeedback();
  units: Unit[] = [];
  unitGradingType = 0;
  unitPenalty: number | undefined;
  showUnits: ShowUnits | number = ShowUnits.None;
  unitsLeft = false;
  instructions = Text.html();
  datasetDefinitions: DatasetDefinition[] = [];
  constructor(
    options: MutableOptions<Calculated<T>, "qtype"> = {},
    qtype: T = "calculated" as T,
  ) {
    super(options);
    this.qtype = qtype;
    Object.assign(this, options);
  }
}

export class CalculatedSimple extends Calculated<"calculatedsimple"> {
  constructor(options: MutableOptions<CalculatedSimple, "qtype"> = {}) {
    super(options, "calculatedsimple");
    Object.assign(this, options);
  }
}

export class CalculatedMulti extends Calculated<"calculatedmulti"> {
  constructor(options: MutableOptions<CalculatedMulti, "qtype"> = {}) {
    super(options, "calculatedmulti");
    Object.assign(this, options);
  }
}

export type AnyQuestion =
  | Category
  | Description
  | Essay
  | ShortAnswer
  | TrueFalse
  | MultiChoice
  | Matching
  | Numerical
  | Cloze
  | Calculated<"calculated">
  | CalculatedSimple
  | CalculatedMulti;

const questionClasses = {
  category: Category,
  description: Description,
  essay: Essay,
  shortanswer: ShortAnswer,
  truefalse: TrueFalse,
  multichoice: MultiChoice,
  match: Matching,
  numerical: Numerical,
  multianswer: Cloze,
  calculated: Calculated,
  calculatedsimple: CalculatedSimple,
  calculatedmulti: CalculatedMulti,
} as const;

export function questionClass(
  qtype: string,
): new (options?: never) => AnyQuestion {
  const canonical =
    qtype === "matching" ? "match" : qtype === "cloze" ? "multianswer" : qtype;
  const found = questionClasses[canonical as keyof typeof questionClasses];
  if (!found)
    throw new RangeError(`Unsupported question type: ${JSON.stringify(qtype)}`);
  return found as new (options?: never) => AnyQuestion;
}

type QuestionByType<T extends QuestionType> = Extract<
  AnyQuestion,
  { qtype: T }
>;

/** Construct a question while preserving its literal `qtype` in the return type. */
export function createQuestion<T extends QuestionType>(
  qtype: T,
  options: Partial<Omit<QuestionByType<T>, "qtype">> = {},
): QuestionByType<T> {
  const Constructor = questionClass(qtype);
  return Object.assign(new Constructor(), options) as QuestionByType<T>;
}

export class Quiz implements Iterable<AnyQuestion> {
  questions: AnyQuestion[];
  constructor(questions: Iterable<AnyQuestion> = []) {
    this.questions = [...questions];
  }
  get length(): number {
    return this.questions.length;
  }
  at(index: number): AnyQuestion | undefined {
    return this.questions.at(index);
  }
  append(question: AnyQuestion): this {
    this.questions.push(question);
    return this;
  }
  [Symbol.iterator](): Iterator<AnyQuestion> {
    return this.questions[Symbol.iterator]();
  }
  realQuestions(): Exclude<AnyQuestion, Category>[] {
    return this.questions.filter(
      (q): q is Exclude<AnyQuestion, Category> => !(q instanceof Category),
    );
  }
  byType<T extends QuestionType>(qtype: T): QuestionByType<T>[] {
    return this.questions.filter(
      (q): q is QuestionByType<T> => q.qtype === qtype,
    );
  }
  byCategory(): Array<readonly [string | undefined, AnyQuestion[]]> {
    const groups: Array<[string | undefined, AnyQuestion[]]> = [
      [undefined, []],
    ];
    for (const question of this.questions) {
      if (question instanceof Category) groups.push([question.category, []]);
      else groups.at(-1)![1].push(question);
    }
    return groups.filter(
      ([name, questions]) => name !== undefined || questions.length > 0,
    );
  }
}
