"use strict";
const shared = require("./shared.js");
class InboxStore extends shared.InboxStore {
  constructor(reader, options = {}) { super(reader.vault.adapter.getBasePath(), { ...options, assertRoot: () => reader.assertVault() }); this.reader = reader; }
}
module.exports = { ...shared, InboxStore, InboxError: shared.VaultError };
