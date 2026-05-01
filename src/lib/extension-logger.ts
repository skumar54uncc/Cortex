/**
 * Console output for extension contexts. Stripped in production builds
 * (__CORTEX_DEBUG__ false). Enabled for `webpack --mode development` unless
 * CORTEX_DEBUG=0; force verbose production bundle with CORTEX_DEBUG=1.
 */

export const devLog = {
  warn(...args: unknown[]): void {
    if (!__CORTEX_DEBUG__) return;
    console.warn(...args);
  },
  error(...args: unknown[]): void {
    if (!__CORTEX_DEBUG__) return;
    console.error(...args);
  },
  info(...args: unknown[]): void {
    if (!__CORTEX_DEBUG__) return;
    console.info(...args);
  },
};
