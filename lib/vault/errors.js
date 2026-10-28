"use strict";
class VaultError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = "VaultError"; this.code = code; Object.assign(this, details); }
}
module.exports = {VaultError};
