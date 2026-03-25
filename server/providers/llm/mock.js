const LOW_RISK_TEMPLATES = {
  "低落": [
    "听起来你这会儿心里有点委屈，我在这儿陪你慢慢说。",
    "嗯，我听见了。你愿意和我讲讲，今天最难受的是哪一刻吗？"
  ],
  "焦虑": [
    "先别急，我们慢一点。跟着我，轻轻吸气，再慢慢呼气。",
    "你现在有点绷紧，我们先把节奏放慢，好不好？"
  ],
  "烦躁": [
    "有情绪很正常，我们先不急着下结论，慢慢把事情理一理。",
    "嗯，我能感觉到你有点烦。你先说，我陪你顺一顺这口气。"
  ],
  "积极": [
    "真好，听到你这样说，我也替你开心。",
    "这份轻松很珍贵，今天可以把这份好心情多留一会儿。"
  ],
  "平静": [
    "我在这儿，你可以把今天想说的事慢慢讲给我听。",
    "嗯，我们就像聊天一样，不着急。"
  ]
};

export function createMockLLM() {
  return {
    name: "mock",
    async generateReply({ text, analysis }) {
      if (analysis.riskLevel === "高") {
        return "你现在的感受很重要，先别一个人扛着。请尽快联系家人、医生或身边可信的人，我会继续陪你。";
      }

      const templates = LOW_RISK_TEMPLATES[analysis.dominantEmotion] ?? LOW_RISK_TEMPLATES["平静"];
      const index = Math.abs(hashCode(text)) % templates.length;
      return templates[index];
    }
  };
}

function hashCode(value) {
  let hash = 0;
  for (const char of value) {
    hash = (hash << 5) - hash + char.charCodeAt(0);
    hash |= 0;
  }
  return hash;
}
