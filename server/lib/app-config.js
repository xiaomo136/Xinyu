import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONFIG_PATH = path.join(ROOT_DIR, "config", "app.config.json");

export async function loadConfig() {
  const raw = await fs.readFile(CONFIG_PATH, "utf-8");
  return JSON.parse(raw.replace(/^\uFEFF/, ""));
}

export function getRootDir() {
  return ROOT_DIR;
}

export function getPublicConfig(config) {
  return {
    app: config.app,
    persona: {
      assistantName: config.persona.assistantName
    },
    providers: {
      llm: {
        type: config.providers.llm.type,
        model: config.providers.llm.ollama?.model ?? "mock"
      },
      asr: {
        type: config.providers.asr.type
      },
      tts: {
        type: config.providers.tts.type,
        activeProvider: config.providers.tts.activeProvider ?? inferLegacyTtsProvider(config),
        availableProviders: ["windows", "gitee_api", "edge_xiaoxiao"]
      },
      avatar: config.providers.avatar
    },
    quickPhrases: config.quickPhrases ?? []
  };
}

function inferLegacyTtsProvider(config) {
  if (config.providers.tts.type === "windows") {
    return "windows";
  }
  if (
    config.providers.tts.type === "api" &&
    config.providers.tts.api?.provider === "gitee_async_audio_speech"
  ) {
    return "gitee_api";
  }
  if (config.providers.tts.type === "browser") {
    return "edge_xiaoxiao";
  }
  return config.providers.tts.type;
}
