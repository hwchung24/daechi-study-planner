"use strict";

function parseSuperAdminEmails() {
  return String(process.env.SUPER_ADMIN_EMAILS || "")
    .split(",")
    .map(email => email.trim().toLowerCase())
    .filter(Boolean);
}

function isSuperAdminEmail(email) {
  const allowlist = parseSuperAdminEmails();
  if (!allowlist.length) return false;
  return allowlist.includes(String(email || "").trim().toLowerCase());
}

module.exports = {
  parseSuperAdminEmails,
  isSuperAdminEmail
};
