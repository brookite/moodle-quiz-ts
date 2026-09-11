export class MoodleQuizError extends Error {
  override readonly name: string = "MoodleQuizError";
}

export class XmlFormatError extends MoodleQuizError {
  override readonly name = "XmlFormatError";
}

export class GiftFormatError extends MoodleQuizError {
  override readonly name = "GiftFormatError";
  readonly sourceText: string;

  constructor(message: string, sourceText = "") {
    super(sourceText ? `${message}\n${sourceText}` : message);
    this.sourceText = sourceText;
  }
}
