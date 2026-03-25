window.createLive2DAvatarAdapter = async function createLive2DAvatarAdapter(container, avatarConfig) {
  const fallbackFactory = window.createPlaceholderAvatarAdapter;

  if (!window.PIXI || !window.PIXI.live2d || !window.PIXI.live2d.Live2DModel) {
    if (typeof fallbackFactory === "function") {
      return fallbackFactory(container, avatarConfig);
    }
    throw new Error("Live2D runtime is not available");
  }

  const live2dConfig = avatarConfig?.live2d ?? {};
  const modelPath = live2dConfig.modelPath ?? "/avatar/sentio/characters/free/Hiyori/Hiyori.model3.json";
  const baseScale = Number.isFinite(Number(live2dConfig.scale)) ? Number(live2dConfig.scale) : 1;

  container.innerHTML = `
    <div class="live2d-shell">
      <canvas class="live2d-canvas"></canvas>
      <div class="live2d-loading">Live2D 载入中...</div>
      <p class="avatar-caption">你好呀，我是心语。你可以把今天的心情慢慢告诉我。</p>
    </div>
  `;

  const shell = container.querySelector(".live2d-shell");
  const canvas = container.querySelector(".live2d-canvas");
  const caption = container.querySelector(".avatar-caption");
  const loading = container.querySelector(".live2d-loading");

  const app = new window.PIXI.Application({
    view: canvas,
    autoStart: true,
    resizeTo: shell,
    antialias: true,
    backgroundAlpha: 0,
    autoDensity: true,
    resolution: Math.max(window.devicePixelRatio || 1, 1)
  });

  let model = null;
  let audioContext = null;
  let audioQueue = [];
  let audioIsPlaying = false;
  let audioSource = null;
  let drainWaiters = [];
  let lipBuffer = null;
  let lipLastRms = 0;
  let pseudoLipTimer = 0;
  let lipFactor = Number.isFinite(Number(live2dConfig.lipFactor)) ? Number(live2dConfig.lipFactor) : 5.0;
  let isLipSyncActive = false;
  let lastExpressionAt = 0;
  let modelLipSyncIds = [];
  let mouthParamIndices = [];
  let mouthParamHandles = [];

  const mouthParamIds = ["ParamMouthOpenY", "PARAM_MOUTH_OPEN_Y", "PARAM_MOUTH_OPENY"];

  const normalizeParamId = (value) => {
    const raw = value && typeof value === "object" && "id" in value ? value.id : value;
    return `${raw ?? ""}`.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  };

  const clampLipFactor = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return lipFactor;
    }
    return Math.min(10, Math.max(0, numeric));
  };

  const ensureAudioPipeline = async () => {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      return false;
    }

    if (!audioContext) {
      audioContext = new AudioContextCtor();
    }
    if (audioContext.state === "suspended") {
      try {
        await audioContext.resume();
      } catch {
        // Resume may fail before user gesture.
      }
    }
    return true;
  };

  let lipAudioSessionStart = 0;
  let smoothedLipParam = 0;

  const beginLipTracking = (buffer) => {
    lipBuffer = buffer;
    lipLastRms = 0;
    lipAudioSessionStart = audioContext.currentTime;  // We will correctly align it strictly with AudioContext.
  };

  const endLipTracking = () => {
    lipBuffer = null;
    lipLastRms = 0;
    smoothedLipParam = 0;
  };

  const calculateVolumeRmsAtTime = (playTimeSeconds) => {
    if (!lipBuffer) {
      lipLastRms = 0;
      return 0;
    }

    const channels = Math.max(1, lipBuffer.numberOfChannels);
    const sampleRate = lipBuffer.sampleRate || 44100;
    const samplesPerChannel = lipBuffer.length || 0;

    // Use a fixed 50ms receding window to calculate volume seamlessly.
    const windowSeconds = 0.05;
    let startOffset = Math.floor((playTimeSeconds - windowSeconds) * sampleRate);
    let endOffset = Math.floor(playTimeSeconds * sampleRate);

    if (startOffset < 0) startOffset = 0;
    if (endOffset > samplesPerChannel) endOffset = samplesPerChannel;

    if (endOffset <= startOffset || startOffset >= samplesPerChannel) {
      lipLastRms = 0;
      return 0;
    }

    let squareSum = 0;
    const sampleCount = endOffset - startOffset;

    for (let c = 0; c < channels; c += 1) {
      const pcm = lipBuffer.getChannelData(c);
      for (let i = startOffset; i < endOffset; i += 1) {
        const v = pcm[i] || 0;
        squareSum += v * v;
      }
    }

    lipLastRms = Math.sqrt(squareSum / (channels * sampleCount));
    return lipLastRms;
  };

  const notifyQueueDrained = () => {
    if (audioIsPlaying || audioQueue.length) {
      return;
    }
    if (!drainWaiters.length) {
      return;
    }

    const waiters = drainWaiters.slice();
    drainWaiters = [];
    for (const resolve of waiters) {
      resolve();
    }
  };

  const pushAudioQueue = (audioData) => {
    if (!(audioData instanceof ArrayBuffer) || !audioData.byteLength) {
      return;
    }
    audioQueue.push(audioData.slice(0));
  };

  const popAudioQueue = () => {
    if (!audioQueue.length) {
      return null;
    }
    return audioQueue.shift() ?? null;
  };

  const clearAudioQueue = () => {
    audioQueue = [];
  };

  const playAudio = async () => {
    if (audioIsPlaying) {
      return null;
    }

    const ready = await ensureAudioPipeline();
    if (!ready) {
      return null;
    }

    const audioData = popAudioQueue();
    if (!audioData) {
      notifyQueueDrained();
      return null;
    }

    audioIsPlaying = true;
    const payload = audioData.slice(0);
    try {
      const buffer = await audioContext.decodeAudioData(payload);
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContext.destination);
      beginLipTracking(buffer);
      source.onended = () => {
        audioIsPlaying = false;
        audioSource = null;
        endLipTracking();
        notifyQueueDrained();
      };
      
      const startTime = audioContext.currentTime + 0.05; // start slightly ahead to guarantee sync and avoid clipping
      source.start(startTime);
      lipAudioSessionStart = startTime; 
      audioSource = source;
      return audioData;
    } catch {
      audioIsPlaying = false;
      audioSource = null;
      endLipTracking();
      notifyQueueDrained();
      return null;
    }
  };

  const stopAudio = () => {
    clearAudioQueue();
    if (audioSource) {
      try {
        audioSource.stop();
      } catch {
        // Ignore stop failures.
      }
      audioSource = null;
    }
    audioIsPlaying = false;
    endLipTracking();
    notifyQueueDrained();
  };

  const isAudioPlaying = () => audioIsPlaying;

  const playQueuedAudio = async () => {
    await ensureAudioPipeline();
    if (!audioIsPlaying) {
      await playAudio();
    }

    if (!audioIsPlaying && !audioQueue.length) {
      return;
    }

    return new Promise((resolve) => {
      drainWaiters.push(resolve);
    });
  };

  const resolveConfiguredLipSyncIds = async () => {
    modelLipSyncIds = [];
    try {
      const response = await fetch(modelPath, { cache: "force-cache" });
      if (!response.ok) {
        return;
      }
      const modelJson = await response.json();
      const groups = Array.isArray(modelJson?.Groups) ? modelJson.Groups : [];
      const lipGroup = groups.find((group) => `${group?.Name ?? ""}`.toLowerCase() === "lipsync");
      const ids = Array.isArray(lipGroup?.Ids) ? lipGroup.Ids : [];
      modelLipSyncIds = ids.filter((id) => typeof id === "string" && id.trim());
    } catch {
      // Ignore parsing failures and fallback to default parameter ids.
    }
  };

  const resolveMouthTargets = () => {
    const coreModel = model?.internalModel?.coreModel;
    mouthParamIndices = [];
    mouthParamHandles = [];
    if (!coreModel) {
      return;
    }

    const preferredIds = modelLipSyncIds.length ? modelLipSyncIds : mouthParamIds;
    const wanted = new Set(preferredIds.map(normalizeParamId));

    if (typeof coreModel.getParameterCount === "function" && typeof coreModel.getParameterId === "function") {
      const count = Number(coreModel.getParameterCount()) || 0;
      for (let i = 0; i < count; i += 1) {
        const idHandle = coreModel.getParameterId(i);
        const normalized = normalizeParamId(idHandle);
        if (wanted.has(normalized)) {
          mouthParamIndices.push(i);
          mouthParamHandles.push(idHandle);
        }
      }
    }

    if (!mouthParamIndices.length && typeof coreModel.getParameterIndex === "function") {
      for (const paramId of preferredIds) {
        const index = coreModel.getParameterIndex(paramId);
        if (Number.isFinite(index) && index >= 0) {
          mouthParamIndices.push(index);
        }
      }
    }
  };

  const resetMouth = () => {
    const coreModel = model?.internalModel?.coreModel;
    if (!coreModel) {
      return;
    }

    if (!mouthParamIndices.length && !mouthParamHandles.length) {
      resolveMouthTargets();
    }

    if (mouthParamIndices.length && typeof coreModel.setParameterValueByIndex === "function") {
      for (const index of mouthParamIndices) {
        try {
          coreModel.setParameterValueByIndex(index, 0);
        } catch {
          // Ignore invalid parameter index.
        }
      }
      return;
    }

    if (mouthParamHandles.length && typeof coreModel.setParameterValueById === "function") {
      for (const idHandle of mouthParamHandles) {
        try {
          coreModel.setParameterValueById(idHandle, 0);
        } catch {
          // Ignore invalid parameter handle.
        }
      }
      return;
    }

    const preferredIds = modelLipSyncIds.length ? modelLipSyncIds : mouthParamIds;
    if (typeof coreModel.setParameterValueById === "function") {
      for (const paramId of preferredIds) {
        try {
          coreModel.setParameterValueById(paramId, 0);
        } catch {
          // Ignore invalid parameter id.
        }
      }
    }
  };

  const forceMouthValue = (value) => {
    const coreModel = model?.internalModel?.coreModel;
    if (!coreModel) {
      return;
    }

    if (!mouthParamIndices.length && !mouthParamHandles.length) {
      resolveMouthTargets();
    }

    const clamped = Math.max(0, Math.min(1, value));
    if (mouthParamIndices.length && typeof coreModel.setParameterValueByIndex === "function") {
      for (const index of mouthParamIndices) {
        try {
          coreModel.setParameterValueByIndex(index, clamped);
        } catch {
          // Ignore invalid parameter index.
        }
      }
      return;
    }

    if (mouthParamHandles.length && typeof coreModel.setParameterValueById === "function") {
      for (const idHandle of mouthParamHandles) {
        try {
          coreModel.setParameterValueById(idHandle, clamped);
        } catch {
          // Ignore invalid parameter handle.
        }
      }
      return;
    }

    const preferredIds = modelLipSyncIds.length ? modelLipSyncIds : mouthParamIds;
    if (typeof coreModel.setParameterValueById === "function") {
      for (const paramId of preferredIds) {
        try {
          coreModel.setParameterValueById(paramId, clamped);
        } catch {
          // Ignore invalid parameter id.
        }
      }
    }
  };

  const stopLipSync = () => {
    if (pseudoLipTimer) {
      clearInterval(pseudoLipTimer);
      pseudoLipTimer = 0;
    }
    isLipSyncActive = false;
    stopAudio();
    resetMouth();
  };

  const startTimedLipSync = () => {};

  const markSpeechBoundary = () => {};

  const bindAudioElement = () => {};

  const startLipSync = async () => {
    const ready = await ensureAudioPipeline();
    if (!ready) {
      return;
    }

    isLipSyncActive = true;
    if (!audioIsPlaying) {
      void playAudio();
    }
  };

  const overrideModelUpdate = (modelObj) => {
    if (!modelObj || !modelObj.internalModel) return;
    const internalModel = modelObj.internalModel;
    const originalUpdate = internalModel.update;
    
    internalModel.update = function(dt, now) {
      // 1. Call original update (this evaluates physics, motions, and resets params)
      originalUpdate.call(this, dt, now);
      
      // 2. Inject precise lip sync based on exact audio timing to eliminate frame-jitter
      if (isLipSyncActive) {
        if (!audioIsPlaying) {
          // Keep mouth closed cleanly
          smoothedLipParam = 0;
          forceMouthValue(0);
          void playAudio();
        } else if (lipBuffer && audioContext) {
          const currentAudioTime = audioContext.currentTime;
          const playTimeSeconds = currentAudioTime - lipAudioSessionStart;
          
          const rms = calculateVolumeRmsAtTime(playTimeSeconds);
          const targetOpen = Math.min(1, Math.max(0, rms * lipFactor));
          
          // Slight low-pass interpolation to smooth out extreme sub-frame vocal transients
          smoothedLipParam = smoothedLipParam * 0.3 + targetOpen * 0.7;
          
          forceMouthValue(smoothedLipParam);
        }
      } else if (pseudoLipTimer) {
        // Pseudo lip sync is managed via interval, but we must re-apply the value here
        // so it isn't overwritten by the motion manager resetting to 0 every frame
        forceMouthValue(smoothedLipParam);
      }
    };
  };

  const startPseudoLipSync = () => {
    stopLipSync();
    pseudoLipTimer = setInterval(() => {
      // Just record the desired target; it gets applied synchronously in the ticker update
      smoothedLipParam = 0.35 + Math.random() * 0.55;
    }, 70);
  };

  const playExpression = () => {
    if (!model) {
      return;
    }
    const now = Date.now();
    if (now - lastExpressionAt < 1500) {
      return;
    }

    const manager = model?.internalModel?.motionManager?.expressionManager;
    if (manager && typeof manager.setRandomExpression === "function") {
      Promise.resolve(manager.setRandomExpression()).catch(() => {});
      lastExpressionAt = now;
      return;
    }

    if (typeof model.expression === "function") {
      try {
        model.expression();
        lastExpressionAt = now;
      } catch {
        // Some models may not expose expressions.
      }
    }
  };

  const playRandomIdleMotion = () => {
    if (!model || typeof model.motion !== "function") {
      return;
    }

    const candidates = [
      ["Idle", Math.floor(Math.random() * 3)],
      ["TapBody", Math.floor(Math.random() * 2)]
    ];

    for (const [group, index] of candidates) {
      try {
        model.motion(group, index, 1);
        break;
      } catch {
        // Motion group/index differs by model, continue trying.
      }
    }
  };

  const layoutModel = () => {
    if (!model) {
      return;
    }

    const width = shell.clientWidth || container.clientWidth || 400;
    const height = shell.clientHeight || container.clientHeight || 280;
    model.anchor.set(0, 0);
    model.scale.set(1);
    const bounds = model.getLocalBounds();
    const intrinsicWidth = Math.max(bounds.width, 1);
    const intrinsicHeight = Math.max(bounds.height, 1);
    const fitScaleX = (width * 0.94) / intrinsicWidth;
    const fitScaleY = (height * 0.98) / intrinsicHeight;
    const scale = Math.max(Math.min(fitScaleX, fitScaleY) * baseScale, 0.08);

    model.scale.set(scale);
    // 使用包围盒做居中与贴底，避免只显示身体局部。
    const targetCenterX = width * 0.5;
    const targetBottomY = height * 0.992;
    const scaledCenterX = (bounds.x + intrinsicWidth * 0.5) * scale;
    const scaledBottomY = (bounds.y + intrinsicHeight) * scale;
    model.position.set(targetCenterX - scaledCenterX, targetBottomY - scaledBottomY);
  };

  try {
    await resolveConfiguredLipSyncIds();
    model = await window.PIXI.live2d.Live2DModel.from(modelPath, {
      autoInteract: false
    });
    app.stage.addChild(model);
    resolveMouthTargets();
    overrideModelUpdate(model);
    layoutModel();
    setTimeout(layoutModel, 60);
    playRandomIdleMotion();

    window.addEventListener("resize", layoutModel);
    if (loading) {
      loading.style.display = "none";
    }
  } catch (error) {
    app.destroy(true, true);
    if (typeof fallbackFactory === "function") {
      return fallbackFactory(container, avatarConfig);
    }
    throw error;
  }

  return {
    bindAudioElement,
    startLipSync,
    startTimedLipSync,
    markSpeechBoundary,
    startPseudoLipSync,
    stopLipSync,
    setLipFactor(value) {
      lipFactor = clampLipFactor(value);
    },
    getLipFactor() {
      return lipFactor;
    },
    pushAudioQueue,
    popAudioQueue,
    clearAudioQueue,
    playAudio,
    playQueuedAudio,
    stopAudio,
    isAudioPlaying,
    setState(state) {
      container.dataset.expression = state?.expression ?? "default";
      container.style.setProperty("--avatar-accent", state?.accent ?? "#4b8f8c");
      caption.textContent = state?.subtitle ?? "我在这里，随时听你说。";
      playRandomIdleMotion();
    }
  };
};
