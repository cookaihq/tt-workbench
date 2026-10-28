"use strict";
const shared = require("./shared.js");
class NoteEditor extends shared.VaultFiles {
  constructor(reader, { io } = {}) {
    super(reader.vault.adapter.getBasePath(), { io, configDir: reader.vault.configDir }); this.reader = reader;
    this.vault = reader.vault; this.parseYaml = shared.parseYaml; this.queue = Promise.resolve();
  }
  enqueue(action) { const operation = this.queue.then(action); this.queue = operation.catch(() => {}); return operation; }
}
module.exports = { NoteEditor, NoteWriteError: shared.VaultError, documentParts: shared.documentParts, patchFields: shared.patchFields, appendSupplement: shared.appendSupplement };
