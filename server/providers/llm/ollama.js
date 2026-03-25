export function createOllamaLLM(config) {
  const ollamaConfig = config.providers.llm.ollama;

  return {
    name: "ollama",
    async generateReply({ messages }) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), ollamaConfig.timeoutMs ?? 45000);

      try {
        const response = await fetch(`${ollamaConfig.baseUrl}/api/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: ollamaConfig.model,
            stream: false,
            messages
          }),
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error(`Ollama request failed: ${response.status}`);
        }

        const data = await response.json();
        return data.message?.content?.trim() || "我在听，你可以继续说。";
      } finally {
        clearTimeout(timer);
      }
    }
  };
}
