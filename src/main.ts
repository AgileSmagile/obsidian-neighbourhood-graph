import { Plugin } from "obsidian";

export default class NeighbourhoodGraphPlugin extends Plugin {
  async onload(): Promise<void> {
    console.debug("[neighbourhood-graph] loaded");
  }

  onunload(): void {
    console.debug("[neighbourhood-graph] unloaded");
  }
}
