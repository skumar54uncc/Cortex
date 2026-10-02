import raw from "./topic-vectors-int8.json";
import type { TopicVector } from "./topics";

interface QuantizedLabel {
  label: string;
  scale: number;
  data: string;
}

/** int8 with one scale per label. Decode to float before cosine. */
export function dequantize(scale: number, bytes: Int8Array): number[] {
  const out = new Array<number>(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = ((bytes[i] ?? 0) / 127) * scale;
  return out;
}

export function quantizeVector(vector: number[]): { scale: number; data: string } {
  let max = 0;
  for (const n of vector) max = Math.max(max, Math.abs(n));
  const scale = max || 1;
  const bytes = new Int8Array(vector.length);
  for (let i = 0; i < vector.length; i++) {
    const q = Math.round(((vector[i] ?? 0) / scale) * 127);
    bytes[i] = Math.max(-127, Math.min(127, q));
  }
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b & 0xff);
  return { scale: Math.round(scale * 1e6) / 1e6, data: btoa(binary) };
}

function bytesFromBase64(data: string): Int8Array {
  const binary = atob(data);
  const bytes = new Int8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i) << 24 >> 24;
  return bytes;
}

export function decodedTopicVectors(
  labels: readonly QuantizedLabel[] = raw.labels
): TopicVector[] {
  return labels.map((row) => ({
    label: row.label,
    vector: dequantize(row.scale, bytesFromBase64(row.data)),
  }));
}
