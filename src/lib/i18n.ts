import en from "./locales/en.json";

type LocaleDict = Record<string, string>;

const locales: Record<string, LocaleDict> = {
  en: en as LocaleDict,
};

let currentLocale = "en";

export function setLocale(code: string): void {
  if (locales[code]) currentLocale = code;
}

export function t(key: string, vars?: Record<string, string | number>): string {
  let str =
    locales[currentLocale]?.[key] ?? locales.en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replaceAll(`{${k}}`, String(v));
    }
  }
  return str;
}
