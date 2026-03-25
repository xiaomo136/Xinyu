export function createBrowserTTSProvider() {
  return {
    name: "edge_xiaoxiao",
    async synthesize() {
      return {
        clientSpeak: true
      };
    }
  };
}
