/** Moodle text format constants (`FORMAT_*`). */
export enum TextFormat {
  Moodle = 0,
  Html = 1,
  Plain = 2,
  Wiki = 3,
  Markdown = 4,
}

const xmlNames: Readonly<Record<TextFormat, string>> = {
  [TextFormat.Moodle]: "moodle_auto_format",
  [TextFormat.Html]: "html",
  [TextFormat.Plain]: "plain_text",
  [TextFormat.Wiki]: "wiki_like",
  [TextFormat.Markdown]: "markdown",
};

const giftNames = new Map<TextFormat, string>([
  [TextFormat.Moodle, "moodle"],
  [TextFormat.Html, "html"],
  [TextFormat.Plain, "plain"],
  [TextFormat.Markdown, "markdown"],
]);

export function textFormatToXml(format: TextFormat): string {
  return xmlNames[format];
}

export function textFormatFromXml(
  name: string | null | undefined,
  fallback = TextFormat.Html,
): TextFormat {
  if (name == null) return fallback;
  const entry = Object.entries(xmlNames).find(
    ([, value]) => value === name.trim(),
  );
  return entry ? (Number(entry[0]) as TextFormat) : TextFormat.Html;
}

export function textFormatToGift(format: TextFormat): string {
  return giftNames.get(format) ?? "moodle";
}

export function textFormatFromGift(name: string): TextFormat | undefined {
  for (const [format, candidate] of giftNames) {
    if (candidate === name.trim()) return format;
  }
  return undefined;
}

export enum ShowUnits {
  TextInput = 0,
  MultipleChoice = 1,
  Dropdown = 2,
  None = 3,
}

export enum ToleranceType {
  Relative = 1,
  Nominal = 2,
  Geometric = 3,
}
