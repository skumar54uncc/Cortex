declare module "*.woff2" {
  const src: string;
  export default src;
}

declare module "*.json" {
  const value: Record<string, unknown> | unknown[];
  export default value;
}
