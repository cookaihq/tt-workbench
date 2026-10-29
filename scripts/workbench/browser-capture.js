/* Drag the generated bookmark in apps/workbench/browser-clipper.html to the browser bookmark bar. */
(() => {
  if (!/^https?:$/.test(location.protocol)) { alert("请在 http 或 https 网页上使用剪藏。"); return; }
  const source = location.href;
  const text = window.getSelection()?.toString().trim() || source;
  // Obsidian consumes `vault` and passes custom fields to the plugin. Its URI
  // decoder preserves '+' literally, so encode spaces as %20 rather than '+'.
  const targetVault = prompt("保存到哪个 Obsidian 库？请输入库名。", "");
  if (!targetVault?.trim()) return;
  const params = Object.entries({ vault: targetVault.trim(), target: targetVault.trim(), title: document.title, text, source })
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&");
  const uri = `obsidian://tt-capture?${params}`;
  if (text.length > 12000 || uri.length > 24000) { alert("选区过长，请分段剪藏，或复制后在工作台保存。当前内容没有截断或保存。"); return; }
  location.href = uri;
})();
