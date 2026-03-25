export function mapAvatarState(analysis) {
  if (!analysis) {
    return {
      expression: "calm",
      motion: "idle",
      subtitle: "我在这里，随时听你说。",
      accent: "#4b8f8c"
    };
  }

  if (analysis.riskLevel === "高") {
    return {
      expression: "concerned",
      motion: "slow-nod",
      subtitle: "先别一个人扛着，我们一起想办法。",
      accent: "#ca6b4f"
    };
  }

  if (analysis.dominantEmotion === "积极") {
    return {
      expression: "warm-smile",
      motion: "soft-wave",
      subtitle: "听到你状态不错，我也替你开心。",
      accent: "#d77f43"
    };
  }

  if (analysis.dominantEmotion === "低落") {
    return {
      expression: "gentle",
      motion: "forward-lean",
      subtitle: "慢慢说，我会认真听着。",
      accent: "#6f87a8"
    };
  }

  if (analysis.dominantEmotion === "焦虑") {
    return {
      expression: "steady",
      motion: "breathing",
      subtitle: "我们先放慢一点，一起把呼吸稳住。",
      accent: "#5b8c6a"
    };
  }

  return {
    expression: "calm",
    motion: "idle",
    subtitle: "我在这里，随时听你说。",
    accent: "#4b8f8c"
  };
}
