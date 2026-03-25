const EMOTION_ALIAS = {
  开心: "积极",
  高兴: "积极",
  难过: "低落",
  悲伤: "低落",
  焦虑: "焦虑",
  生气: "烦躁",
  愤怒: "烦躁",
  平静: "平静",
  neutral: "平静",
  sad: "低落",
  happy: "积极",
  angry: "烦躁",
  anxious: "焦虑"
};

export function analyzeRisk({ text, speechEmotion, faceEmotion, config }) {
  const normalizedText = `${text ?? ""}`.trim();
  const highRiskKeywords = config.safety.highRiskKeywords ?? [];
  const negativeKeywords = config.safety.negativeKeywords ?? [];
  const positiveKeywords = config.safety.positiveKeywords ?? [];

  let score = 0;
  const reasons = [];

  for (const keyword of highRiskKeywords) {
    if (normalizedText.includes(keyword)) {
      score += 80;
      reasons.push(`检测到高风险表述：${keyword}`);
    }
  }

  for (const keyword of negativeKeywords) {
    if (normalizedText.includes(keyword)) {
      score += 12;
      reasons.push(`检测到消极信号：${keyword}`);
    }
  }

  for (const keyword of positiveKeywords) {
    if (normalizedText.includes(keyword)) {
      score -= 8;
    }
  }

  const emotionVotes = [speechEmotion, faceEmotion]
    .filter(Boolean)
    .map((item) => EMOTION_ALIAS[item] ?? item);

  const dominantEmotion = inferEmotion(normalizedText, emotionVotes);

  if (dominantEmotion === "低落") {
    score += 10;
  }
  if (dominantEmotion === "焦虑") {
    score += 16;
  }
  if (dominantEmotion === "烦躁") {
    score += 10;
  }
  if (dominantEmotion === "积极") {
    score -= 10;
  }

  const riskLevel = resolveRiskLevel(score);
  const supportAdvice = buildSupportAdvice(riskLevel, dominantEmotion);

  return {
    dominantEmotion,
    riskLevel,
    score: Math.max(score, 0),
    reasons,
    supportAdvice
  };
}

function inferEmotion(text, emotionVotes) {
  if (emotionVotes.length) {
    return emotionVotes[0];
  }
  if (/(睡不着|心慌|焦虑|担心|害怕)/.test(text)) {
    return "焦虑";
  }
  if (/(孤单|难过|压抑|没意思|想哭)/.test(text)) {
    return "低落";
  }
  if (/(烦|生气|火大)/.test(text)) {
    return "烦躁";
  }
  if (/(开心|高兴|踏实|轻松)/.test(text)) {
    return "积极";
  }
  return "平静";
}

function resolveRiskLevel(score) {
  if (score >= 80) {
    return "高";
  }
  if (score >= 28) {
    return "中";
  }
  return "低";
}

function buildSupportAdvice(riskLevel, emotion) {
  if (riskLevel === "高") {
    return "建议尽快联系家人、医生或专业热线，当前回复以安抚和转介为主。";
  }
  if (riskLevel === "中" && emotion === "焦虑") {
    return "优先做放松引导，帮助用户慢呼吸、坐稳、描述当下环境。";
  }
  if (riskLevel === "中" && emotion === "低落") {
    return "优先表达理解与陪伴，适度追问近期睡眠、饮食与社交状态。";
  }
  if (emotion === "积极") {
    return "鼓励用户继续保持稳定作息和日常互动。";
  }
  return "保持自然陪聊，继续观察用户情绪变化。";
}
