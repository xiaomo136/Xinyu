import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SCRIPT_PATH = path.join(ROOT_DIR, "tools", "windows_tts.py");
const OUTPUT_DIR = path.join(ROOT_DIR, "data", "tts");

export function createWindowsTTSProvider(config) {
  const providerConfig = config.providers.tts.windows ?? {};
  const pythonPath = providerConfig.pythonPath || "python";

  return {
    name: "windows",
    async synthesize({ text, speechRate }) {
      await fs.mkdir(OUTPUT_DIR, { recursive: true });
      const outputPath = path.join(OUTPUT_DIR, `${Date.now()}-${crypto.randomUUID()}.wav`);
      const textPath = path.join(OUTPUT_DIR, `${Date.now()}-${crypto.randomUUID()}.txt`);
      const effectiveRate = resolveWindowsRate(providerConfig.rate ?? 150, speechRate);

      try {
        await fs.writeFile(textPath, text, "utf-8");
        await execFileAsync(pythonPath, [
          SCRIPT_PATH,
          "--text-file",
          textPath,
          "--output",
          outputPath,
          "--voice-hint",
          providerConfig.voiceHint ?? "Chinese",
          "--rate",
          String(effectiveRate),
          "--volume",
          String(providerConfig.volume ?? 1.0)
        ]);

        const buffer = await fs.readFile(outputPath);
        return {
          audioBase64: buffer.toString("base64"),
          mimeType: "audio/wav"
        };
      } finally {
        await fs.rm(textPath, { force: true });
        await fs.rm(outputPath, { force: true });
      }
    }
  };
}

function resolveWindowsRate(baseRate, speechRate) {
  const numericBase = Number(baseRate) || 150;
  const numericScale = Number(speechRate) || 1;
  return Math.max(90, Math.min(260, Math.round(numericBase * numericScale)));
}
