import fs from "node:fs/promises";
import path from "node:path";

export class SessionStore {
  constructor(rootDir, maxHistoryTurns, summarySourceTurns) {
    this.filePath = path.join(rootDir, "data", "session-state.json");
    this.maxHistoryTurns = maxHistoryTurns;
    this.summarySourceTurns = summarySourceTurns;
    this.state = {
      summary: "",
      turns: [],
      lastAnalysis: null,
      lastAvatar: null,
      updatedAt: null
    };
  }

  async init() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      this.state = JSON.parse(raw);
    } catch {
      await this.persist();
    }
  }

  getState() {
    return this.state;
  }

  async reset() {
    this.state = {
      summary: "",
      turns: [],
      lastAnalysis: null,
      lastAvatar: null,
      updatedAt: new Date().toISOString()
    };
    await this.persist();
    return this.state;
  }

  async appendTurn(turn) {
    this.state.turns.push(turn);

    if (this.state.turns.length > this.maxHistoryTurns) {
      const archived = this.state.turns.slice(0, this.state.turns.length - this.maxHistoryTurns);
      this.state.summary = this.buildSummary(archived.slice(-this.summarySourceTurns));
      this.state.turns = this.state.turns.slice(-this.maxHistoryTurns);
    }

    this.state.lastAnalysis = turn.analysis;
    this.state.lastAvatar = turn.avatar;
    this.state.updatedAt = new Date().toISOString();
    await this.persist();
  }

  buildSummary(archivedTurns) {
    if (!archivedTurns.length) {
      return "";
    }

    return archivedTurns
      .map((turn) => {
        const user = turn.userText.slice(0, 24);
        const mood = turn.analysis?.dominantEmotion ?? "平静";
        return `用户提到“${user}”，当时情绪偏${mood}`;
      })
      .join("；");
  }

  async persist() {
    await fs.writeFile(this.filePath, JSON.stringify(this.state, null, 2), "utf-8");
  }
}
