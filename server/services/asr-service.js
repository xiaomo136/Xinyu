import { createFunASRProvider } from "../providers/asr/funasr.js";

export class AsrService {
  constructor({ config }) {
    this.config = config;
    this.provider =
      config.providers.asr.type === "funasr" ? createFunASRProvider(config) : null;
  }

  async transcribe(payload) {
    if (!this.provider) {
      throw new Error("当前未启用服务端 ASR，请使用浏览器语音识别或配置 FunASR 服务。");
    }

    const result = await this.provider.transcribe(payload);
    if (!result.text) {
      throw new Error("未识别到有效语音内容");
    }

    return {
      providerName: this.provider.name,
      text: result.text
    };
  }
}
