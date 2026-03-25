export function createGiteeAsyncTTSProvider(providerConfig) {
  const headers = {
    Authorization: `Bearer ${providerConfig.token}`
  };

  return {
    name: "api",
    async synthesize({ text, speechRate }) {
      const task = await createTask({ providerConfig, headers, text, speechRate });

      if (!task.task_id) {
        throw new Error("Gitee TTS response missing task_id");
      }

      const result = await pollTask({
        providerConfig,
        headers,
        taskId: task.task_id
      });

      const fileUrl = result.output?.file_url;
      if (!fileUrl) {
        throw new Error("Gitee TTS completed without file_url");
      }

      const audioResponse = await fetch(fileUrl);
      if (!audioResponse.ok) {
        throw new Error(`Gitee TTS audio download failed: ${audioResponse.status}`);
      }

      const audioBuffer = await audioResponse.arrayBuffer();
      const rawMimeType =
        audioResponse.headers.get("content-type") ?? inferMimeTypeFromUrl(fileUrl);

      return {
        audioBase64: Buffer.from(audioBuffer).toString("base64"),
        mimeType: normalizeMimeType(rawMimeType, fileUrl)
      };
    }
  };
}

async function createTask({ providerConfig, headers, text, speechRate }) {
  const response = await fetch(providerConfig.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers
    },
    body: JSON.stringify({
      inputs: text,
      model: providerConfig.model ?? "Spark-TTS-0.5B",
      gender: providerConfig.gender ?? "male",
      pitch: providerConfig.pitch ?? 3,
      speed: resolveApiSpeed(providerConfig.speed ?? 3, speechRate)
    })
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.message || `Gitee TTS task creation failed: ${response.status}`);
  }
  if (payload.error) {
    throw new Error(`${payload.error}: ${payload.message ?? "Unknown error"}`);
  }
  return payload;
}

async function pollTask({ providerConfig, headers, taskId }) {
  const statusUrl = providerConfig.statusUrlTemplate.replace("{task_id}", taskId);
  const pollIntervalMs = providerConfig.pollIntervalMs ?? 10000;
  const maxAttempts = providerConfig.maxAttempts ?? 180;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(statusUrl, { headers });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.message || `Gitee TTS status failed: ${response.status}`);
    }
    if (payload.error) {
      throw new Error(`${payload.error}: ${payload.message ?? "Unknown error"}`);
    }

    const status = payload.status ?? "unknown";
    if (status === "success") {
      return payload;
    }
    if (status === "failed" || status === "cancelled") {
      throw new Error(`Gitee TTS task ${status}`);
    }

    await sleep(pollIntervalMs);
  }

  throw new Error("Gitee TTS polling timed out");
}

function inferMimeTypeFromUrl(fileUrl) {
  const lowerUrl = fileUrl.toLowerCase();
  if (lowerUrl.endsWith(".mp3")) {
    return "audio/mpeg";
  }
  if (lowerUrl.endsWith(".wav")) {
    return "audio/wav";
  }
  return "application/octet-stream";
}

function normalizeMimeType(rawMimeType, fileUrl) {
  const lowerMimeType = `${rawMimeType ?? ""}`.toLowerCase();
  if (lowerMimeType.includes("video/mpeg")) {
    return "audio/mpeg";
  }
  if (lowerMimeType.includes("mpeg") && fileUrl.toLowerCase().endsWith(".mp3")) {
    return "audio/mpeg";
  }
  return rawMimeType;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveApiSpeed(baseSpeed, speechRate) {
  const numericBase = Number(baseSpeed) || 3;
  const numericScale = Number(speechRate) || 1;
  const mappedSpeed = numericBase + Math.round((numericScale - 1) * 4);
  return Math.max(1, Math.min(9, mappedSpeed));
}
