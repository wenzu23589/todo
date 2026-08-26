#!/usr/bin/env node
"use strict";
/*
 * Builds and sends the daily email digest: overdue tasks, tasks due today,
 * and tasks due in the next few days, pulled from data/tasks.json.
 *
 * Run by .github/workflows/daily-digest.yml on a schedule. Can also be run
 * locally:
 *   node scripts/send-digest.js [tasksPath] [settingsPath]
 *
 * Sending requires two repo secrets (a Gmail address + an App Password for
 * it — see the README): GMAIL_USER and GMAIL_APP_PASSWORD. If those aren't
 * set, or the digest is toggled off in data/digest-settings.json, or no
 * recipient email is configured, the script exits quietly without sending.
 */
const fs = require("fs");

const DUE_SOON_DAYS = 3;

function pad2(n) { return n < 10 ? "0" + n : "" + n; }
function todayStr(now, timeZone) {
  var fmt = new Intl.DateTimeFormat("en-CA", { timeZone: timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  var parts = fmt.formatToParts(now);
  var map = {};
  parts.forEach(function (p) { map[p.type] = p.value; });
  return map.year + "-" + map.month + "-" + map.day;
}
function addDaysStr(dateStr, n) {
  var d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate());
}

// Flattens every non-archived, non-done task out of the heading/subheading tree,
// tagging each with the heading (and sub-heading, if any) it belongs to.
function flattenTasks(state) {
  var out = [];
  var headings = (state && Array.isArray(state.headings)) ? state.headings : [];
  headings.forEach(function (h) {
    (h.tasks || []).forEach(function (t) {
      out.push({ task: t, heading: h.title, sub: null });
    });
    (h.subheadings || []).forEach(function (sh) {
      (sh.tasks || []).forEach(function (t) {
        out.push({ task: t, heading: h.title, sub: sh.title });
      });
    });
  });
  return out.filter(function (row) { return !row.task.done && !row.task.archivedAt; });
}

// Pure function: given the tasks state, settings, and "now", returns the digest
// content (or null if there's nothing to send it for). Kept separate from the
// actual mail transport so it's easy to unit-test without a network.
function buildDigest(state, settings, now, timeZone) {
  timeZone = timeZone || "Europe/Malta";
  if (!settings || !settings.enabled || !settings.email) return null;

  var today = todayStr(now, timeZone);
  var soonCutoff = addDaysStr(today, DUE_SOON_DAYS);

  var overdue = [], dueToday = [], dueSoon = [];
  flattenTasks(state).forEach(function (row) {
    var due = row.task.due;
    if (!due || !due.date) return;
    if (due.date < today) overdue.push(row);
    else if (due.date === today) dueToday.push(row);
    else if (due.date <= soonCutoff) dueSoon.push(row);
  });

  function sortByDate(rows) {
    return rows.slice().sort(function (a, b) { return (a.task.due.date + (a.task.due.time || "")) < (b.task.due.date + (b.task.due.time || "")) ? -1 : 1; });
  }
  overdue = sortByDate(overdue);
  dueToday = sortByDate(dueToday);
  dueSoon = sortByDate(dueSoon);

  var totalCount = overdue.length + dueToday.length + dueSoon.length;
  var subject = totalCount === 0
    ? "Daybook: nothing due today — you're all caught up"
    : "Daybook: " + totalCount + " task" + (totalCount === 1 ? "" : "s") + " need" + (totalCount === 1 ? "s" : "") + " attention";

  function rowLabel(row) {
    var label = row.task.text;
    var loc = row.sub ? (row.heading + " • " + row.sub) : row.heading;
    var when = row.task.due.allDay || !row.task.due.time ? "" : (" at " + row.task.due.time);
    return { label: label, loc: loc, when: row.task.due.date + when };
  }

  function textSection(title, rows) {
    if (!rows.length) return "";
    return title + ":\n" + rows.map(function (row) {
      var r = rowLabel(row);
      return "  - " + r.label + " (" + r.loc + ", due " + r.when + ")";
    }).join("\n") + "\n\n";
  }
  var text = "";
  if (totalCount === 0) {
    text = "Nothing overdue or due in the next " + DUE_SOON_DAYS + " days. Nice work.\n\n";
  } else {
    text += textSection("Overdue", overdue);
    text += textSection("Due today", dueToday);
    text += textSection("Due soon", dueSoon);
  }
  text += "— Daybook";

  function htmlSection(title, rows, color) {
    if (!rows.length) return "";
    return '<h3 style="margin:18px 0 6px;font-family:Georgia,serif;color:' + color + '">' + title + '</h3><ul style="margin:0;padding-left:20px;">' +
      rows.map(function (row) {
        var r = rowLabel(row);
        return '<li style="margin-bottom:4px;"><strong>' + escapeHtml(r.label) + '</strong> <span style="color:#5b6270;">— ' + escapeHtml(r.loc) + ', due ' + escapeHtml(r.when) + '</span></li>';
      }).join("") + '</ul>';
  }
  var html = '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;color:#1c2130;max-width:520px;">' +
    '<h2 style="font-family:Georgia,serif;margin:0 0 4px;">Daybook</h2>' +
    '<p style="color:#5b6270;margin:0 0 8px;">' + escapeHtml(today) + '</p>';
  if (totalCount === 0) {
    html += '<p>Nothing overdue or due in the next ' + DUE_SOON_DAYS + ' days. Nice work.</p>';
  } else {
    html += htmlSection("Overdue", overdue, "#b8452f");
    html += htmlSection("Due today", dueToday, "#a8672a");
    html += htmlSection("Due soon", dueSoon, "#3f7d6e");
  }
  html += '</div>';

  return { subject: subject, text: text, html: html, counts: { overdue: overdue.length, dueToday: dueToday.length, dueSoon: dueSoon.length } };
}

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch (e) { return fallback; }
}

async function main() {
  var tasksPath = process.argv[2] || "data/tasks.json";
  var settingsPath = process.argv[3] || "data/digest-settings.json";
  var timeZone = process.env.DIGEST_TIMEZONE || "Europe/Malta";

  var state = readJson(tasksPath, { headings: [] });
  var settings = readJson(settingsPath, { enabled: false, email: "" });

  var digest = buildDigest(state, settings, new Date(), timeZone);
  if (!digest) {
    console.log("Digest is off (or no recipient set) — nothing to send.");
    return;
  }

  var user = process.env.GMAIL_USER;
  var pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    console.log("GMAIL_USER / GMAIL_APP_PASSWORD secrets aren't set — skipping send. (Digest would have been: \"" + digest.subject + "\")");
    return;
  }

  var nodemailer = require("nodemailer");
  var transporter = nodemailer.createTransport({ service: "gmail", auth: { user: user, pass: pass } });
  await transporter.sendMail({
    from: "Daybook <" + user + ">",
    to: settings.email,
    subject: digest.subject,
    text: digest.text,
    html: digest.html
  });
  console.log("Sent digest to " + settings.email + ": \"" + digest.subject + "\" (overdue " + digest.counts.overdue + ", today " + digest.counts.dueToday + ", soon " + digest.counts.dueSoon + ")");
}

module.exports = { buildDigest, flattenTasks, todayStr, addDaysStr };

if (require.main === module) {
  main().catch(function (err) { console.error(err); process.exit(1); });
}
