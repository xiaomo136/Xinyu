import { analyzeRisk } from "./risk-engine.js";
import { mapAvatarState } from "./avatar-mapper.js";
import { createMockLLM } from "../providers/llm/mock.js";
import { createOllamaLLM } from "../providers/llm/ollama.js";

export class ChatService {
  constructor({ config, sessionStore }) {
    this.config = config;
    this.sessionStore = sessionStore;
    this.mockLLM = createMockLLM();
    this.primaryLLM =
      config.providers.llm.type === "ollama" ? createOllamaLLM(config) : this.mockLLM;
    this.chatMode = `${config.conversation?.mode ?? "dialogue"}`.toLowerCase();
  }

  async chat({ text, speechEmotion, faceEmotion }) {
    const cleanText = `${text ?? ""}`.trim();
    if (!cleanText) {
      throw new Error("消息不能为空");
    }

    const analysis = analyzeRisk({
      text: cleanText,
      speechEmotion,
      faceEmotion,
      config: this.config
    });

    let reply;
    let providerName;

    if (this.chatMode === "repeater" || this.chatMode === "echo") {
      // 复读机模式：直接复述用户输入，保持可验证、低偏差输出。
      reply = cleanText;
      providerName = "repeater";
    } else {
      const messages = this.buildMessages(cleanText, analysis);
      providerName = this.primaryLLM.name;

      try {
        reply = await this.primaryLLM.generateReply({
          text: cleanText,
          analysis,
          messages
        });
      } catch {
        providerName = `${this.primaryLLM.name} -> mock`;
        reply = await this.mockLLM.generateReply({
          text: cleanText,
          analysis,
          messages
        });
      }
    }

    const avatar = mapAvatarState(analysis);
    const turn = {
      userText: cleanText,
      assistantText: limitReply(reply, this.config.conversation.maxReplyChars),
      analysis,
      avatar,
      providerName,
      createdAt: new Date().toISOString()
    };

    await this.sessionStore.appendTurn(turn);

    return {
      reply: turn.assistantText,
      analysis,
      avatar,
      providerName,
      summary: this.sessionStore.getState().summary,
      history: this.sessionStore.getState().turns
    };
  }

  buildMessages(userText, analysis) {
    const state = this.sessionStore.getState();
    const recentTurns = state.turns.slice(-6);
    const systemPrompt = [
      this.config.persona.systemRole,
      this.config.persona.replyStyle,
      this.config.persona.safetyBoundary,
      `当前识别到的用户情绪：${analysis.dominantEmotion}。`,
      `当前风险等级：${analysis.riskLevel}。`,
      `建议的支持策略：${analysis.supportAdvice}`
    ].join("\n");

    const messages = [{ role: "system", content: systemPrompt }];

    if (state.summary) {
      messages.push({
        role: "system",
        content: `历史摘要：${state.summary}`
      });
    }

    for (const turn of recentTurns) {
      messages.push({ role: "user", content: turn.userText });
      messages.push({ role: "assistant", content: turn.assistantText });
    }

    messages.push({ role: "user", content: userText });
    return messages;
  }
}

function limitReply(text, maxChars) {
  if (!text) {
    return "我在听，你可以继续说。";
  }
  return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;
}
