"use strict";

const fs = require("fs");
const path = require("path");

let cache;

function getKoFallbacks() {
  if (!cache) {
    const p = path.join(__dirname, "..", "..", "src", "coach", "fallbacks", "ko.json");
    cache = JSON.parse(fs.readFileSync(p, "utf8"));
  }
  return cache;
}

/** `{{key}}` 치환 */
function tpl(str, vars) {
  const v = vars || {};
  return String(str || "").replace(/\{\{(\w+)\}\}/g, (_, k) =>
    v[k] != null && v[k] !== "" ? String(v[k]) : ""
  );
}

module.exports = { getKoFallbacks, tpl };
