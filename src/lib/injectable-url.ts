/** URLs where Cortex may inject content scripts (not chrome://, file://, etc.). */
export function isInjectableWebUrl(url: string | undefined | null): boolean {
  return (
    typeof url === "string" &&
    (url.startsWith("http://") || url.startsWith("https://"))
  );
}
