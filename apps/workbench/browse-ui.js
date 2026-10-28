"use strict";
const { ROOTS } = require("./vault-paths.js");
const { isBusinessPath } = require("./note-reader.js");
class BrowseUI {
  constructor(view) { this.view = view; this.generation = 0; }
  active() { const scope = this.view.pageScope; return scope === "" || !["@tasks", "@projects", "@issues", ROOTS.inbox].includes(scope); }
  render(files) {
    const v = this.view, generation = ++this.generation, scope = v.pageScope, prefix = scope ? `${scope}/` : "";
    v.searchInput.placeholder = "搜索当前目录的标题、路径或正文…";
    v.searchInput.setAttribute("aria-label", "搜索当前目录及子目录的标题、路径或正文");
    const nav = v.filterEl.createDiv({ cls: "tw-browse-breadcrumb" });
    v.button(nav, "浏览全部业务笔记", "全部笔记", () => v.navigate(""));
    const segments = scope.split("/").filter(Boolean);
    segments.forEach((part, i) => { nav.createSpan({ text: " / " }); v.button(nav, `浏览目录 ${segments.slice(0, i + 1).join("/")}`, part, () => v.navigate(segments.slice(0, i + 1).join("/"))); });
    const candidates = files.filter(f => f.path.startsWith(prefix));
    v.listEl.empty();
    if (v.query.trim()) {
      v.countEl.setText("正在搜索当前目录及子目录…");
      void this.search(candidates, v.query, generation); return;
    }
    const folders = new Set();
    for (const file of candidates) { const remainder = file.path.slice(prefix.length); if (remainder.includes("/")) folders.add(prefix + remainder.split("/")[0]); }
    for (const file of v.app.vault.getAllLoadedFiles()) {
      if (!v.showFixtures && v.fixtureDirectories?.some(directory => file.path === directory || file.path.startsWith(`${directory}/`))) continue;
      if (Array.isArray(file.children) && file.path.startsWith(prefix) && file.path !== scope && !file.path.slice(prefix.length).includes("/") && isBusinessPath(`${file.path}/scope.md`)) folders.add(file.path);
    }
    for (const folder of [...folders].sort((a, b) => a.localeCompare(b, "zh-CN"))) {
      const button = v.button(v.listEl, `打开文件夹 ${folder}`, "", () => v.navigate(folder)); button.addClass("tw-note", "tw-folder"); button.dataset.folder = folder;
      button.createEl("strong", { text: `▸ ${folder.split("/").at(-1)}` }); button.createSpan({ text: "文件夹", cls: "tw-note-path" });
    }
    const direct = candidates.filter(f => !f.path.slice(prefix.length).includes("/"));
    for (const file of direct) this.note(file);
    v.countEl.setText(`文件夹 · ${folders.size}　笔记 · ${direct.length}`);
    if (!folders.size && !direct.length) v.listEl.createEl("p", { text: "这个目录还没有笔记。", cls: "tw-empty" });
  }
  note(file, snippet = "") {
    const v = this.view, button = v.button(v.listEl, `阅读 ${file.path}`, "", () => v.openNote(file.path));
    button.addClass("tw-note"); button.dataset.path = file.path; button.setAttribute("aria-pressed", String(v.selectedPath === file.path));
    button.createEl("strong", { text: file.title }); button.createSpan({ text: file.path, cls: "tw-note-path" });
    if (snippet) button.createDiv({ text: snippet, cls: "tw-note-preview" });
  }
  async search(files, query, generation) {
    const v = this.view, q = query.trim().toLocaleLowerCase(), found = []; let unreadable = 0;
    for (let start = 0; start < files.length; start += 8) {
      const batch = await Promise.all(files.slice(start, start + 8).map(async file => {
        try {
          const note = await v.reader.read(file.path); const position = note.content.toLocaleLowerCase().indexOf(q);
          return `${file.title} ${file.path}`.toLocaleLowerCase().includes(q) || position >= 0 ? { file, snippet: position < 0 ? "" : note.content.slice(Math.max(0, position - 35), position + 140).replace(/\s+/g, " ") } : null;
        } catch { ++unreadable; return null; }
      }));
      if (generation !== this.generation || v.closed || !this.active()) return;
      found.push(...batch.filter(Boolean));
    }
    v.listEl.empty(); for (const item of found) this.note(item.file, item.snippet);
    v.countEl.setText(`搜索结果 · ${found.length}${unreadable ? ` · ${unreadable} 份暂不可读` : ""}`);
    if (!found.length) v.listEl.createEl("p", { text: "当前目录及子目录没有匹配结果。", cls: "tw-empty" });
  }
}
module.exports = { BrowseUI };
