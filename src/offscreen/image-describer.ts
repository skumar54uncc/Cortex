/**
 * On-device image descriptions (Phase 5.8) through the Chrome Prompt API with
 * image input. Runs in the offscreen document only. Pixels arrive as data
 * URLs from the page, are decoded here, and never leave the device.
 */
import type { ImageDescriber, ImageForDescription } from "../lib/capture/images";
import { NANO_OUTPUT_LANGUAGE } from "../lib/chat/nano-client";

const DESCRIBE_PROMPT =
  "Describe this image in one or two plain sentences for a personal search index. Mention visible text, objects and setting. Do not guess names of people.";

interface ImageLanguageModel {
  availability(o: unknown): Promise<string>;
  create(o: unknown): Promise<{ prompt(input: unknown): Promise<string>; destroy(): void }>;
}

/**
 * `outputLanguage` is required on every request: without it Chrome logs
 * "No output language was specified in a LanguageModel API request".
 */
const IMAGE_MODEL_OPTIONS = {
  outputLanguage: NANO_OUTPUT_LANGUAGE,
  expectedInputs: [{ type: "text", languages: [NANO_OUTPUT_LANGUAGE] }, { type: "image" }],
  expectedOutputs: [{ type: "text", languages: [NANO_OUTPUT_LANGUAGE] }],
};

function lm(): ImageLanguageModel | undefined {
  return (globalThis as { LanguageModel?: ImageLanguageModel }).LanguageModel;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(",");
  const mime = /^data:([^;]+);/.exec(dataUrl)?.[1] ?? "image/jpeg";
  const bin = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function promptApiImageDescriber(): ImageDescriber {
  return {
    available: async () => {
      const api = lm();
      if (!api) return false;
      return (await api.availability(IMAGE_MODEL_OPTIONS)) === "available";
    },
    describe: async (img: ImageForDescription) => {
      const api = lm();
      if (!api) throw new Error("Prompt API unavailable");
      const session = await api.create(IMAGE_MODEL_OPTIONS);
      try {
        return await session.prompt([
          {
            role: "user",
            content: [
              { type: "text", value: DESCRIBE_PROMPT },
              { type: "image", value: dataUrlToBlob(img.dataUrl) },
            ],
          },
        ]);
      } finally {
        session.destroy();
      }
    },
  };
}
