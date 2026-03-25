export function createFunASRProvider(config) {
  const providerConfig = config.providers.asr.funasr;

  return {
    name: "funasr",
    async transcribe({ audioBase64, sampleRate, mimeType }) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), providerConfig.timeoutMs ?? 60000);

      try {
        const response = await fetch(`${providerConfig.baseUrl}${providerConfig.recognizePath}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            audioBase64,
            sampleRate: sampleRate ?? providerConfig.sampleRate ?? 16000,
            mimeType: mimeType ?? "audio/wav"
          }),
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error(`FunASR request failed: ${response.status}`);
        }

        const data = await response.json();
        return {
          text: data.text?.trim() ?? ""
        };
      } finally {
        clearTimeout(timer);
      }
    }
  };
}
