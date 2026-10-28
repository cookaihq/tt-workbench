"use strict";
const fs = require("node:fs"), path = require("node:path");
module.exports = require(fs.existsSync(path.join(__dirname, "lib/vault/index.js")) ? "./lib/vault/index.js" : "../../lib/vault/index.js");
