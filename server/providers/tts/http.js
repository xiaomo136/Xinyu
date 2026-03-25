export function createHttpTTSProvider({ name, providerConfig }) {
  return {
    name,
    async synthesize({ text, speechRate }) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), providerConfig.timeoutMs ?? 60000);

      try {
        const response = await fetch(providerConfig.url, {
          method: providerConfig.method ?? "POST",
          headers: {
            "Content-Type": "application/json",
            ...(providerConfig.headers ?? {})
          },
          body: JSON.stringify({ text, speechRate }),
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error(`${name} TTS request failed: ${response.status}`);
        }

        const contentType = response.headers.get("content-type") ?? "application/octet-stream";
        if (contentType.includes("application/json")) {
          const data = await response.json();
          if (!data.audioBase64) {
            throw new Error(`${name} TTS response missing audioBase64`);
          }
          return {
            audioBase64: data.audioBase64,
            mimeType: data.mimeType ?? "audio/wav"
          };
        }

        const arrayBuffer = await response.arrayBuffer();
        return {
          audioBase64: Buffer.from(arrayBuffer).toString("base64"),
          mimeType: contentType
        };
      } finally {
        clearTimeout(timer);
      }
    }
  };
}
