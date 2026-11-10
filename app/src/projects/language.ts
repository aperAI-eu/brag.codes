// Canonical BCP 47 language, optionally script and region. No private-use/extensions.
// null = not identified yet (including legacy records); und = indeterminate; mul = mixed.
export function validLanguage(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-(?:[A-Z]{2}|[0-9]{3}))?$/.test(value)
  )
    return false;
  try {
    return (
      Intl.getCanonicalLocales(value)[0] === value &&
      (value === "und" ||
        value === "mul" ||
        new Intl.DisplayNames(["en"], { type: "language", fallback: "none" }).of(
          value.split("-")[0],
        ) !== undefined)
    );
  } catch {
    return false;
  }
}
export function languageLabel(value: string): string {
  if (value === "und") return "Not enough speech to identify";
  if (value === "mul") return "Mixed languages";
  try {
    return `${new Intl.DisplayNames(["en"], { type: "language" }).of(value) || value} (${value})`;
  } catch {
    return value;
  }
}
