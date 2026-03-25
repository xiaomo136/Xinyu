import { createWindowsTTSProvider } from "../providers/tts/windows.js";
import { createHttpTTSProvider } from "../providers/tts/http.js";
import { createGiteeAsyncTTSProvider } from "../providers/tts/gitee-async.js";
import { createBrowserTTSProvider } from "../providers/tts/browser.js";

export class TtsService {
  constructor({ config }) {
    this.config = config;
    this.availableProviders = ["windows", "gitee_api", "edge_xiaoxiao"];
    this.activeProvider = this.resolveInitialProvider();
    this.provider = this.createProvider(this.activeProvider);
  }

  resolveInitialProvider() {
    if (this.config.providers.tts.activeProvider) {
      return this.normalizeProviderName(this.config.providers.tts.activeProvider);
    }
    if (this.config.providers.tts.type === "windows") {
      return "windows";
    }
    if (this.config.providers.tts.api?.provider === "gitee_async_audio_speech") {
      return "gitee_api";
    }
    return this.normalizeProviderName(this.config.providers.tts.type);
  }

  normalizeProviderName(providerName) {
    const normalized = `${providerName ?? ""}`.trim().toLowerCase();
    if (normalized === "windows" || normalized === "windows_tts") {
      return "windows";
    }
    if (
      normalized === "gitee_api" ||
      normalized === "gitee" ||
      normalized === "api" ||
      normalized === "gitee_async_audio_speech"
    ) {
      return "gitee_api";
    }
    if (
      normalized === "edge_xiaoxiao" ||
      normalized === "edge" ||
      normalized === "browser" ||
      normalized === "xiaoxiao"
    ) {
      return "edge_xiaoxiao";
    }
    return normalized;
  }

  createProvider(providerName) {
    if (providerName === "windows") {
      return createWindowsTTSProvider(this.config);
    }
    if (providerName === "local_service") {
      return createHttpTTSProvider({
        name: "local_service",
        providerConfig: this.config.providers.tts.localService
      });
    }
    if (providerName === "gitee_api") {
      return createGiteeAsyncTTSProvider(this.config.providers.tts.api);
    }
    if (providerName === "edge_xiaoxiao") {
      return createBrowserTTSProvider();
    }
    return null;
  }

  setProvider(providerName) {
    const normalized = this.normalizeProviderName(providerName);
    if (!this.availableProviders.includes(normalized)) {
      throw new Error(`不支持的 TTS provider: ${providerName}`);
    }

    this.activeProvider = normalized;
    this.config.providers.tts.activeProvider = normalized;
    if (normalized === "gitee_api") {
      this.config.providers.tts.type = "api";
    } else if (normalized === "edge_xiaoxiao") {
      this.config.providers.tts.type = "browser";
    } else {
      this.config.providers.tts.type = normalized;
    }
    this.provider = this.createProvider(normalized);

    return this.getProviderState();
  }

  getProviderState() {
    return {
      activeProvider: this.activeProvider,
      availableProviders: this.availableProviders
    };
  }

  async synthesize({ text, speechRate }) {
    const normalizedSpeechRate = normalizeSpeechRate(speechRate);

    if (!this.provider) {
      return {
        providerName: "browser",
        clientSpeak: true,
        speechRate: normalizedSpeechRate
      };
    }

    const result = await this.provider.synthesize({
      text,
      speechRate: normalizedSpeechRate
    });
    return {
      providerName: this.activeProvider,
      clientSpeak: result.clientSpeak ?? false,
      speechRate: normalizedSpeechRate,
      ...result
    };
  }
}

function normalizeSpeechRate(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 1;
  }
  return Math.max(0.75, Math.min(1.6, numeric));
}
