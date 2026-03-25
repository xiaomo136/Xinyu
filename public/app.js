let appConfig = null;
let avatarAdapter = null;
let recognition = null;
let speakingEnabled = true;
let submitInFlight = false;
let playbackAudio = null;
let playbackAudioUrl = null;
let audioUnlocked = false;
let voiceLoop = createVoiceLoopState();
let asrStatus = {
  ready: false,
  message: ""
};

const ttsSettings = loadTtsSettings();

const emotionValue = document.getElementById("emotionValue");
const riskValue = document.getElementById("riskValue");
const llmValue = document.getElementById("llmValue");
const asrValue = document.getElementById("asrValue");
const ttsValue = document.getElementById("ttsValue");
const adviceText = document.getElementById("adviceText");
const chatList = document.getElementById("chatList");
const quickPhrases = document.getElementById("quickPhrases");
const messageInput = document.getElementById("messageInput");
const micButton = document.getElementById("micButton");
const sendButton = document.getElementById("sendButton");
const resetButton = document.getElementById("resetButton");
const speakReplyToggle = document.getElementById("speakReplyToggle");
const networkHint = document.getElementById("networkHint");
const voiceHint = document.getElementById("voiceHint");
const ttsSwitchHint = document.getElementById("ttsSwitchHint");
const ttsWindowsButton = document.getElementById("ttsWindowsButton");
const ttsGiteeButton = document.getElementById("ttsGiteeButton");
const ttsEdgeButton = document.getElementById("ttsEdgeButton");
const avatarStage = document.getElementById("avatarStage");
const unlockAudioButton = document.getElementById("unlockAudioButton");
const audioHint = document.getElementById("audioHint");
const speechRateSlider = document.getElementById("speechRateSlider");
const speechRateValue = document.getElementById("speechRateValue");
const realtimeHint = document.getElementById("realtimeHint");

window.setTtsProvider = switchTtsProvider;
window.setSpeechRate = (value) => setSpeechRate(value, { announce: true });
window.startRealtimeVoice = startRealtimeConversation;
window.stopRealtimeVoice = () => stopRealtimeConversation({ announce: true });

boot();

async function boot() {
  initPlaybackAudio();
  bindPassiveAudioUnlock();
  bindEvents();
  initBrowserRecognition();
  updateSpeechRateUI();
  updateAudioHint();

  await loadConfig();
  await loadHealth();
  await loadHistory();

  initAvatar();
  renderQuickPhrases();
  updateProviderValues();
}

async function loadConfig() {
  const response = await fetch("/api/config");
  const data = await response.json();
  appConfig = data.config;
}

async function loadHealth() {
  const response = await fetch("/api/health");
  const data = await response.json();
  const firstLanUrl = data.lanUrls?.[0];
  if (data.providers?.ttsActiveProvider && appConfig?.providers?.tts) {
    appConfig.providers.tts.activeProvider = data.providers.ttsActiveProvider;
  }
  asrStatus.ready = Boolean(data.providers?.asrReady);
  asrStatus.message = data.providers?.asrMessage ?? "";
  if (firstLanUrl) {
    networkHint.textContent = `手机与电脑在同一 Wi-Fi 下时，可访问：${firstLanUrl}`;
  } else {
    networkHint.textContent = "当前没有检测到可用局域网地址，可先在本机打开。";
  }
}

async function loadHistory() {
  const response = await fetch("/api/history");
  const data = await response.json();
  chatList.innerHTML = "";

  for (const turn of data.state.turns ?? []) {
    appendMessage("user", turn.userText, "");
    appendMessage("assistant", turn.assistantText, buildMeta(turn.analysis, turn.providerName));
  }

  if (data.state.lastAnalysis) {
    updateAnalysis(data.state.lastAnalysis, data.state.lastAvatar, data.state.turns.at(-1)?.providerName);
  } else {
    appendMessage("assistant", "你好呀，我是心语。你可以把今天的心情慢慢告诉我。", "系统已就绪");
  }
}

function initAvatar() {
  if (window.createPlaceholderAvatarAdapter) {
    avatarAdapter = window.createPlaceholderAvatarAdapter(avatarStage, appConfig.providers.avatar);
  }

  avatarAdapter?.setState({
    expression: "calm",
    subtitle: "你好呀，我是心语。你可以把今天的心情慢慢告诉我。",
    accent: "#4b8f8c"
  });
}

function renderQuickPhrases() {
  quickPhrases.innerHTML = "";
  for (const phrase of appConfig.quickPhrases ?? []) {
    const button = document.createElement("button");
    button.className = "quick-chip";
    button.type = "button";
    button.textContent = phrase;
    button.addEventListener("click", async () => {
      messageInput.value = phrase;
      await submitMessage();
    });
    quickPhrases.appendChild(button);
  }
}

function bindEvents() {
  sendButton.addEventListener("click", () => {
    void submitMessage();
  });
  resetButton.addEventListener("click", () => {
    void resetConversation();
  });
  ttsWindowsButton.addEventListener("click", () => {
    void switchTtsProvider("windows");
  });
  ttsGiteeButton.addEventListener("click", () => {
    void switchTtsProvider("gitee_api");
  });
  ttsEdgeButton.addEventListener("click", () => {
    void switchTtsProvider("edge_xiaoxiao");
  });
  unlockAudioButton.addEventListener("click", () => {
    void unlockAudioPlayback(true);
  });
  speakReplyToggle.addEventListener("change", (event) => {
    speakingEnabled = event.target.checked;
  });
  micButton.addEventListener("click", () => {
    void toggleRecording();
  });
  speechRateSlider.addEventListener("input", (event) => {
    setSpeechRate(event.target.value);
  });
  speechRateSlider.addEventListener("change", () => {
    appendMessage("assistant", `播报语速已调整为 ${ttsSettings.speechRate.toFixed(2)}x。`, "语音设置");
  });
  messageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitMessage();
    }
  });
}

function bindPassiveAudioUnlock() {
  const unlock = () => {
    void unlockAudioPlayback(false);
  };
  window.addEventListener("pointerdown", unlock, { once: true, passive: true });
  window.addEventListener("keydown", unlock, { once: true, passive: true });
}

function initBrowserRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = "zh-CN";
  recognition.continuous = false;
  recognition.interimResults = false;

  recognition.onstart = () => {
    micButton.classList.add("recording");
    micButton.textContent = "正在聆听";
    avatarAdapter?.setState({
      expression: "steady",
      subtitle: "我在认真听，你慢慢说。",
      accent: "#5b8c6a"
    });
  };

  recognition.onresult = (event) => {
    const transcript = event.results?.[0]?.[0]?.transcript?.trim();
    if (transcript) {
      messageInput.value = transcript;
      void submitMessage();
    }
  };

  recognition.onend = () => {
    micButton.classList.remove("recording");
    updateMicButton();
  };

  recognition.onerror = () => {
    micButton.classList.remove("recording");
    updateMicButton();
  };
}

function updateProviderValues() {
  llmValue.textContent = appConfig.providers.llm.model ?? appConfig.providers.llm.type;
  asrValue.textContent = appConfig.providers.asr.type;
  ttsValue.textContent = appConfig.providers.tts.activeProvider ?? appConfig.providers.tts.type;
  voiceHint.textContent = getVoiceHint();
  ttsSwitchHint.textContent =
    `当前激活的 TTS 是 ${appConfig.providers.tts.activeProvider ?? appConfig.providers.tts.type}，` +
    `语速 ${ttsSettings.speechRate.toFixed(2)}x。实时对话建议用 edge_xiaoxiao；也可用 window.setTtsProvider(...) 和 window.setSpeechRate(1.2) 直接调整。`;
  updateMicButton();
  updateRealtimeHint();
  updateAudioHint();
}

function updateMicButton() {
  if (!appConfig) {
    return;
  }

  micButton.disabled = false;
  micButton.classList.remove("recording", "processing");

  if (voiceLoop.active) {
    if (voiceLoop.processing) {
      micButton.classList.add("processing");
      micButton.textContent = "识别中...";
      return;
    }
    if (voiceLoop.paused) {
      micButton.classList.add("processing");
      micButton.textContent = "处理中...";
      return;
    }
    micButton.classList.add("recording");
    micButton.textContent = "停止实时对话";
    return;
  }

  micButton.textContent = appConfig.providers.asr.type === "funasr" ? "开始实时对话" : "语音输入";
}

function getVoiceHint() {
  if (appConfig.providers.asr.type === "funasr") {
    return asrStatus.ready
      ? `当前使用 FunASR 语音识别。${asrStatus.message}`
      : `FunASR 未连接。${asrStatus.message || "请先启动桥接服务。"} `;
  }
  return "当前使用浏览器语音识别。";
}

function updateRealtimeHint(message) {
  if (!realtimeHint) {
    return;
  }

  if (message) {
    voiceLoop.statusText = message;
  }

  if (voiceLoop.active) {
    realtimeHint.textContent =
      voiceLoop.statusText || "实时对话已开启，停顿约 1 秒后会自动识别并回复。";
    return;
  }

  realtimeHint.textContent =
    voiceLoop.statusText ||
    (appConfig?.providers?.asr?.type === "funasr"
      ? "点击左侧按钮后持续监听，停顿约 1 秒会自动提交到 FunASR。"
      : "当前使用浏览器语音识别，点按钮后说完会自动提交。");
}

function updateAudioHint(message) {
  if (!audioHint) {
    return;
  }

  if (message) {
    audioHint.textContent = message;
  } else if (audioUnlocked) {
    audioHint.textContent = "声音已启用，手机端回复会优先自动播放。";
  } else {
    audioHint.textContent = "手机首次打开时，先点一次“启用声音”，后续回复更容易自动播报。";
  }

  unlockAudioButton.textContent = audioUnlocked ? "声音已启用" : "启用声音";
}

function updateSpeechRateUI() {
  const value = ttsSettings.speechRate.toFixed(2);
  speechRateSlider.value = String(ttsSettings.speechRate);
  speechRateValue.textContent = `${value}x`;
}

function setSpeechRate(value, { announce = false } = {}) {
  const normalized = clampSpeechRate(value);
  ttsSettings.speechRate = normalized;
  saveTtsSettings();
  updateSpeechRateUI();
  if (appConfig) {
    updateProviderValues();
  }
  if (announce) {
    appendMessage("assistant", `播报语速已调整为 ${normalized.toFixed(2)}x。`, "语音设置");
  }
  return normalized;
}

async function switchTtsProvider(providerName) {
  const response = await fetch("/api/tts/provider", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ providerName })
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.error || "TTS provider 切换失败");
  }

  appConfig.providers.tts.activeProvider = data.activeProvider;
  updateProviderValues();
  appendMessage("assistant", `TTS 已切换到 ${data.activeProvider}。`, "系统设置");
  return data;
}

async function toggleRecording() {
  await unlockAudioPlayback(false);

  if (appConfig.providers.asr.type === "funasr") {
    if (voiceLoop.active) {
      await stopRealtimeConversation({ announce: true });
    } else {
      await startRealtimeConversation();
    }
    return;
  }

  if (recognition) {
    recognition.start();
    return;
  }

  appendMessage("assistant", "当前浏览器不支持语音识别，可以先用文字输入。", "语音提示");
}

async function startRealtimeConversation() {
  if (!navigator.mediaDevices?.getUserMedia) {
    fallbackToBrowserAsr("当前浏览器不支持麦克风采集，已尝试回退浏览器语音识别。");
    return;
  }

  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) {
    fallbackToBrowserAsr("当前浏览器不支持 WebAudio，已尝试回退浏览器语音识别。");
    return;
  }

  await loadHealth();
  if (!asrStatus.ready) {
    updateProviderValues();
    appendMessage("assistant", "FunASR 还没连上，请先启动桥接服务后再开始实时对话。", "ASR 提示");
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    const audioContext = new AudioContextCtor();
    await audioContext.resume();

    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(2048, 1, 1);
    const muteNode = audioContext.createGain();
    muteNode.gain.value = 0;

    source.connect(processor);
    processor.connect(muteNode);
    muteNode.connect(audioContext.destination);

    voiceLoop = {
      active: true,
      paused: false,
      processing: false,
      stream,
      audioContext,
      source,
      processor,
      muteNode,
      sampleRate: audioContext.sampleRate || 16000,
      threshold: 0.014,
      silenceLimitMs: 950,
      minSpeechMs: 380,
      maxSpeechMs: 12000,
      phraseChunks: [],
      speechMs: 0,
      silenceMs: 0,
      statusText: "实时对话已开启，停顿约 1 秒后会自动识别并回复。"
    };

    processor.onaudioprocess = (event) => {
      handleRealtimeAudioProcess(voiceLoop, event);
    };

    updateMicButton();
    updateRealtimeHint();
    avatarAdapter?.setState({
      expression: "steady",
      subtitle: "实时对话已开启，我在认真听。",
      accent: "#5b8c6a"
    });
    appendMessage("assistant", "实时对话已开启，你说完停顿一下，我会自动识别并回复。", "语音模式");
  } catch (error) {
    const message = resolveMicErrorMessage(error);
    appendMessage("assistant", message, "语音启动失败");
    updateRealtimeHint(message);
  }
}

async function stopRealtimeConversation({ announce = false } = {}) {
  if (!voiceLoop.active) {
    updateMicButton();
    return;
  }

  stopAllAudioPlayback();

  try {
    voiceLoop.processor?.disconnect();
    voiceLoop.source?.disconnect();
    voiceLoop.muteNode?.disconnect();
    voiceLoop.stream?.getTracks().forEach((track) => track.stop());
    if (voiceLoop.audioContext && voiceLoop.audioContext.state !== "closed") {
      await voiceLoop.audioContext.close();
    }
  } finally {
    voiceLoop = createVoiceLoopState();
    updateMicButton();
    updateRealtimeHint();
    avatarAdapter?.setState({
      expression: "calm",
      subtitle: "实时对话已停止，你也可以继续打字和我聊。",
      accent: "#4b8f8c"
    });
    if (announce) {
      appendMessage("assistant", "实时对话已停止。", "语音模式");
    }
  }
}

function handleRealtimeAudioProcess(session, event) {
  if (voiceLoop !== session || !session.active || session.paused || session.processing) {
    return;
  }

  const input = new Float32Array(event.inputBuffer.getChannelData(0));
  const frameDurationMs = (input.length / session.sampleRate) * 1000;
  const rms = calculateRms(input);

  if (rms >= session.threshold) {
    if (session.phraseChunks.length === 0) {
      updateRealtimeHint("检测到你在说话了，停顿后会自动发送。");
      avatarAdapter?.setState({
        expression: "steady",
        subtitle: "我在认真听，你慢慢说。",
        accent: "#5b8c6a"
      });
    }
    session.phraseChunks.push(input);
    session.speechMs += frameDurationMs;
    session.silenceMs = 0;
    return;
  }

  if (!session.phraseChunks.length) {
    return;
  }

  session.phraseChunks.push(input);
  session.speechMs += frameDurationMs;
  session.silenceMs += frameDurationMs;

  if (session.speechMs >= session.maxSpeechMs) {
    void processRealtimeSegment(session);
    return;
  }

  if (session.silenceMs >= session.silenceLimitMs) {
    if (session.speechMs >= session.minSpeechMs) {
      void processRealtimeSegment(session);
    } else {
      resetRealtimeSegment(session);
      updateRealtimeHint("没有检测到完整语句，继续监听中。");
    }
  }
}

async function processRealtimeSegment(session) {
  if (!session.active || session.processing || !session.phraseChunks.length) {
    return;
  }

  const chunks = session.phraseChunks.slice();
  const sampleRate = session.sampleRate;

  session.processing = true;
  session.paused = true;
  resetRealtimeSegment(session);
  updateMicButton();
  updateRealtimeHint("正在识别并生成回复...");
  avatarAdapter?.setState({
    expression: "steady",
    subtitle: "我在整理你的话。",
    accent: "#4b8f8c"
  });

  try {
    const wavBuffer = encodeWav(chunks, sampleRate);
    const result = await recognizeWithFunAsr(wavBuffer, sampleRate);
    if (!result.text) {
      throw new Error("未识别到有效语音");
    }

    session.processing = false;
    await submitMessage({ text: result.text, resumeRealtimeAfterReply: true });
  } catch (error) {
    session.processing = false;
    const message = resolveAsrError(error);
    if (message) {
      appendMessage("assistant", message, "ASR 提示");
    }
    if (session.active) {
      session.paused = false;
      updateMicButton();
      updateRealtimeHint("继续监听中，停顿后会自动回复。");
    }
  }
}

async function recognizeWithFunAsr(wavBuffer, sampleRate) {
  const response = await fetch("/api/asr/recognize", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      audioBase64: arrayBufferToBase64(wavBuffer),
      sampleRate,
      mimeType: "audio/wav"
    })
  });

  const data = await response.json();
  if (!response.ok || !data.ok) {
    const detail = data.error || data.detail || "FunASR 调用失败";
    throw new Error(detail);
  }
  return data;
}

async function submitMessage({ text = messageInput.value, resumeRealtimeAfterReply = voiceLoop.active } = {}) {
  const normalizedText = text.trim();
  if (!normalizedText || submitInFlight) {
    return;
  }

  submitInFlight = true;
  await unlockAudioPlayback(false);

  if (voiceLoop.active) {
    pauseRealtimeCapture("我在想怎样更温柔地回应你。");
  }

  appendMessage("user", normalizedText, "");
  messageInput.value = "";

  avatarAdapter?.setState({
    expression: "steady",
    subtitle: "我在想怎样更温柔地回应你。",
    accent: "#4b8f8c"
  });

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ text: normalizedText })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "对话请求失败");
    }

    appendMessage("assistant", data.reply, buildMeta(data.analysis, data.providerName));
    updateAnalysis(data.analysis, data.avatar, data.providerName);
    if (speakingEnabled) {
      await playReplyAudio(data.reply);
    }
  } catch {
    appendMessage("assistant", "网络连接出了点问题，你可以稍后再试。", "请求异常");
  } finally {
    submitInFlight = false;
    if (resumeRealtimeAfterReply && voiceLoop.active) {
      await resumeRealtimeCapture("继续监听中，停顿后会自动回复。");
    } else {
      updateMicButton();
      updateRealtimeHint();
    }
  }
}

function pauseRealtimeCapture(message) {
  if (!voiceLoop.active) {
    return;
  }

  voiceLoop.paused = true;
  resetRealtimeSegment(voiceLoop);
  updateMicButton();
  updateRealtimeHint(message);
}

async function resumeRealtimeCapture(message) {
  if (!voiceLoop.active) {
    return;
  }

  voiceLoop.paused = false;
  voiceLoop.processing = false;
  resetRealtimeSegment(voiceLoop);
  if (voiceLoop.audioContext?.state === "suspended") {
    await voiceLoop.audioContext.resume();
  }
  updateMicButton();
  updateRealtimeHint(message);
  avatarAdapter?.setState({
    expression: "steady",
    subtitle: "我还在继续听你说。",
    accent: "#5b8c6a"
  });
}

function resetRealtimeSegment(session) {
  session.phraseChunks = [];
  session.speechMs = 0;
  session.silenceMs = 0;
}

function fallbackToBrowserAsr(message) {
  appendMessage("assistant", message, "ASR 提示");
  asrStatus.ready = false;
  asrStatus.message = message;
  if (recognition) {
    updateProviderValues();
    recognition.start();
  } else {
    micButton.disabled = true;
    micButton.textContent = "语音不可用";
  }
}

async function playReplyAudio(text) {
  try {
    const response = await fetch("/api/tts/synthesize", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        text,
        speechRate: ttsSettings.speechRate
      })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "TTS 调用失败");
    }

    if (data.clientSpeak) {
      await speakInBrowser(text);
      return;
    }

    await playBase64Audio(data.audioBase64, data.mimeType);
  } catch {
    try {
      await speakInBrowser(text);
    } catch {
      updateAudioHint("手机浏览器拦截了自动播报，请先点一次“启用声音”。");
    }
  }
}

function initPlaybackAudio() {
  playbackAudio = new Audio();
  playbackAudio.preload = "auto";
  playbackAudio.playsInline = true;
  playbackAudio.setAttribute("playsinline", "true");
}

async function unlockAudioPlayback(showFeedback) {
  if (!playbackAudio) {
    initPlaybackAudio();
  }

  let silentUrl = null;

  try {
    const silentBuffer = encodeWav([new Float32Array(1600)], 16000);
    const silentBlob = new Blob([silentBuffer], { type: "audio/wav" });
    silentUrl = URL.createObjectURL(silentBlob);

    playbackAudio.muted = true;
    playbackAudio.src = silentUrl;
    await playbackAudio.play();
    playbackAudio.pause();
    playbackAudio.currentTime = 0;
    playbackAudio.removeAttribute("src");
    playbackAudio.load();
    playbackAudio.muted = false;

    audioUnlocked = true;
    updateAudioHint();
    if (showFeedback) {
      appendMessage("assistant", "声音已经启用，后续回复会尽量自动播放。", "音频提示");
    }
    return true;
  } catch {
    audioUnlocked = false;
    updateAudioHint("浏览器还没允许自动播报，请在手机上点一次“启用声音”。");
    return false;
  } finally {
    if (silentUrl) {
      URL.revokeObjectURL(silentUrl);
    }
  }
}

async function playBase64Audio(audioBase64, mimeType = "audio/wav") {
  if (!audioBase64) {
    throw new Error("音频内容为空");
  }

  stopAllAudioPlayback();
  await unlockAudioPlayback(false);

  const blob = new Blob([base64ToUint8Array(audioBase64)], { type: mimeType });
  playbackAudioUrl = URL.createObjectURL(blob);
  playbackAudio.src = playbackAudioUrl;

  const playbackEnded = waitForAudioEnd(playbackAudio);
  try {
    await playbackAudio.play();
  } catch (error) {
    stopAllAudioPlayback();
    throw error;
  }
  audioUnlocked = true;
  updateAudioHint();
  await playbackEnded;
}

function waitForAudioEnd(audio) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("error", handleError);
      if (playbackAudioUrl) {
        URL.revokeObjectURL(playbackAudioUrl);
        playbackAudioUrl = null;
      }
    };

    const handleEnded = () => {
      cleanup();
      resolve();
    };

    const handleError = () => {
      cleanup();
      reject(new Error("音频播放失败"));
    };

    audio.addEventListener("ended", handleEnded, { once: true });
    audio.addEventListener("error", handleError, { once: true });
  });
}

function stopAllAudioPlayback() {
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }

  if (!playbackAudio) {
    return;
  }

  playbackAudio.pause();
  playbackAudio.currentTime = 0;
  playbackAudio.removeAttribute("src");
  playbackAudio.load();
  if (playbackAudioUrl) {
    URL.revokeObjectURL(playbackAudioUrl);
    playbackAudioUrl = null;
  }
}

async function speakInBrowser(text) {
  if (!("speechSynthesis" in window)) {
    throw new Error("当前浏览器不支持语音播报");
  }

  await unlockAudioPlayback(false);

  return new Promise((resolve, reject) => {
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-CN";
    utterance.rate = ttsSettings.speechRate;
    utterance.pitch = 1;

    const preferredVoice = pickPreferredBrowserVoice(window.speechSynthesis.getVoices());
    if (preferredVoice) {
      utterance.voice = preferredVoice;
    }

    utterance.onend = () => {
      audioUnlocked = true;
      updateAudioHint();
      resolve();
    };
    utterance.onerror = () => {
      reject(new Error("浏览器语音播报失败"));
    };

    window.speechSynthesis.speak(utterance);
  });
}

async function resetConversation() {
  if (voiceLoop.active) {
    await stopRealtimeConversation();
  }

  await fetch("/api/reset", { method: "POST" });
  chatList.innerHTML = "";
  appendMessage("assistant", "会话已经清空，我们重新开始吧。", "已重置");
  updateAnalysis(
    {
      dominantEmotion: "平静",
      riskLevel: "低",
      supportAdvice: "保持自然陪聊，继续观察用户情绪变化。"
    },
    {
      expression: "calm",
      subtitle: "我们重新开始吧，我还在这里。",
      accent: "#4b8f8c"
    },
    appConfig.providers.llm.model ?? appConfig.providers.llm.type
  );
}

function updateAnalysis(analysis, avatar, providerName) {
  emotionValue.textContent = analysis?.dominantEmotion ?? "平静";
  riskValue.textContent = analysis?.riskLevel ?? "低";
  llmValue.textContent = providerName ?? appConfig.providers.llm.model ?? appConfig.providers.llm.type;
  adviceText.textContent = analysis?.supportAdvice ?? "我会结合你的状态给出更稳妥的陪伴建议。";
  avatarAdapter?.setState(avatar);
}

function appendMessage(role, content, metaText) {
  const wrapper = document.createElement("article");
  wrapper.className = `message ${role}`;
  wrapper.textContent = content;

  if (metaText) {
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = metaText;
    wrapper.appendChild(meta);
  }

  chatList.appendChild(wrapper);
  chatList.scrollTop = chatList.scrollHeight;
}

function buildMeta(analysis, providerName) {
  return `情绪：${analysis?.dominantEmotion ?? "平静"} · 风险：${analysis?.riskLevel ?? "低"} · 引擎：${providerName ?? appConfig.providers.llm.type}`;
}

function pickPreferredBrowserVoice(voices) {
  if (!Array.isArray(voices) || !voices.length) {
    return null;
  }

  const preferredPatterns = [
    /xiaoxiao/i,
    /晓晓/i,
    /microsoft xiaoxiao/i,
    /zh-cn-xiaoxiao/i
  ];

  for (const pattern of preferredPatterns) {
    const matched = voices.find((voice) => pattern.test(voice.name) || pattern.test(voice.voiceURI));
    if (matched) {
      return matched;
    }
  }

  return (
    voices.find((voice) => /zh-cn/i.test(voice.lang) && /microsoft/i.test(voice.name)) ||
    voices.find((voice) => /zh|Chinese/i.test(voice.lang) || /Chinese/i.test(voice.name)) ||
    null
  );
}

function calculateRms(buffer) {
  let sum = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    sum += buffer[index] * buffer[index];
  }
  return Math.sqrt(sum / buffer.length);
}

function encodeWav(chunks, sampleRate) {
  const merged = mergeBuffers(chunks);
  const buffer = new ArrayBuffer(44 + merged.length * 2);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + merged.length * 2, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, merged.length * 2, true);

  let offset = 44;
  for (let index = 0; index < merged.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, merged[index]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }

  return buffer;
}

function mergeBuffers(chunks) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Float32Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function writeString(view, offset, value) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function loadTtsSettings() {
  try {
    const raw = window.localStorage.getItem("xinyu.tts.settings");
    if (!raw) {
      return { speechRate: 1.1 };
    }
    const parsed = JSON.parse(raw);
    return {
      speechRate: clampSpeechRate(parsed.speechRate ?? 1.1)
    };
  } catch {
    return { speechRate: 1.1 };
  }
}

function saveTtsSettings() {
  window.localStorage.setItem("xinyu.tts.settings", JSON.stringify(ttsSettings));
}

function clampSpeechRate(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 1.1;
  }
  return Math.max(0.75, Math.min(1.6, numeric));
}

function createVoiceLoopState() {
  return {
    active: false,
    paused: false,
    processing: false,
    stream: null,
    audioContext: null,
    source: null,
    processor: null,
    muteNode: null,
    sampleRate: 16000,
    threshold: 0.014,
    silenceLimitMs: 950,
    minSpeechMs: 380,
    maxSpeechMs: 12000,
    phraseChunks: [],
    speechMs: 0,
    silenceMs: 0,
    statusText: ""
  };
}

function resolveMicErrorMessage(error) {
  const message = `${error?.message ?? ""}`.toLowerCase();
  if (error?.name === "NotAllowedError" || message.includes("permission")) {
    return "麦克风权限被拒绝了，请先在浏览器里允许访问麦克风。";
  }
  if (error?.name === "NotFoundError") {
    return "没有检测到可用麦克风，请检查设备。";
  }
  if (error?.name === "SecurityError" || message.includes("secure context") || message.includes("https")) {
    return "手机浏览器通常需要 HTTPS 才能采集麦克风，局域网 http 页面可能只能先用文字聊天。";
  }
  return "实时对话启动失败，请检查麦克风、浏览器权限和网络环境。";
}

function resolveAsrError(error) {
  const rawMessage = `${error?.message ?? ""}`;
  const lowerMessage = rawMessage.toLowerCase();

  if (rawMessage.includes("未识别到有效语音")) {
    return "";
  }
  if (lowerMessage.includes("failed to fetch") || lowerMessage.includes("funasr")) {
    asrStatus.ready = false;
    asrStatus.message = "FunASR 当前不可用";
    updateProviderValues();
    return "FunASR 当前不可用，请检查桥接服务是否启动。";
  }
  return "刚才那段语音没有处理成功，我们再试一次。";
}
