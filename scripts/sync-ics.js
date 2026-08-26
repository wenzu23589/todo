#!/usr/bin/env node
"use strict";
/*
 * Fetches each iCal (.ics) feed listed in data/ics-feeds.json, expands recurring
 * events within a rolling window, converts every occurrence to a fixed timezone's
 * wall-clock date/time, and writes the flattened result to data/ics-events.json.
 *
 * Run by .github/workflows/sync-ics.yml on a schedule. Can also be run locally:
 *   node scripts/sync-ics.js [feedsPath] [outputPath]
 */
const fs = require("fs");
const path = require("path");
const ical = require("node-ical");

const DAYS_BACK = 7;
const DAYS_FORWARD = 60;

function wallClock(date, timeZone) {
  var fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false
  });
  var parts = fmt.formatToParts(date);
  var map = {};
  parts.forEach(function (p) { map[p.type] = p.value; });
  return { date: map.year + "-" + map.month + "-" + map.day, time: map.hour + ":" + map.minute };
}

function pad2(n) { return n < 10 ? "0" + n : "" + n; }

function utcDateOnlyStr(d) {
  return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate());
}

// Expands a parsed VEVENT (possibly recurring) into concrete occurrences within [windowStart, windowEnd].
function expandEvent(ev, windowStart, windowEnd) {
  var occurrences = [];
  var dateOnly = !!(ev.start && ev.start.dateOnly);
  if (ev.rrule) {
    var dates = ev.rrule.between(windowStart, windowEnd, true);
    var durationMs = ev.end ? (ev.end.getTime() - ev.start.getTime()) : 0;
    var exdates = {};
    if (ev.exdate) {
      Object.keys(ev.exdate).forEach(function (k) {
        exdates[new Date(ev.exdate[k]).toISOString()] = true;
      });
    }
    dates.forEach(function (d) {
      if (exdates[d.toISOString()]) return;
      occurrences.push({ start: d, end: new Date(d.getTime() + durationMs), dateOnly: dateOnly });
    });
  } else if (ev.start && ev.start >= windowStart && ev.start <= windowEnd) {
    occurrences.push({ start: ev.start, end: ev.end || ev.start, dateOnly: dateOnly });
  }
  return occurrences;
}

function occurrenceToFields(occ, timeZone) {
  if (occ.dateOnly) {
    return { date: utcDateOnlyStr(occ.start), time: null, allDay: true };
  }
  var wc = wallClock(occ.start, timeZone);
  return { date: wc.date, time: wc.time, allDay: false };
}

function eventsFromParsedIcal(parsed, windowStart, windowEnd, timeZone, feedId) {
  var out = [];
  for (var key in parsed) {
    var ev = parsed[key];
    if (!ev || ev.type !== "VEVENT" || !ev.start) continue;
    var occs = expandEvent(ev, windowStart, windowEnd);
    occs.forEach(function (occ) {
      var fields = occurrenceToFields(occ, timeZone);
      out.push({
        feedId: feedId,
        uid: String(ev.uid || key) + "|" + fields.date + (fields.time ? "T" + fields.time : ""),
        summary: (ev.summary || "(untitled)").toString(),
        date: fields.date,
        time: fields.time,
        allDay: fields.allDay
      });
    });
  }
  return out;
}

async function syncFeeds(feeds, opts) {
  opts = opts || {};
  var timeZone = opts.timeZone || "Europe/Malta";
  var now = opts.now || new Date();
  var windowStart = new Date(now.getTime() - DAYS_BACK * 24 * 60 * 60 * 1000);
  var windowEnd = new Date(now.getTime() + DAYS_FORWARD * 24 * 60 * 60 * 1000);
  var fetchIcs = opts.fetchIcs || function (url) { return ical.async.fromURL(url); };

  var allEvents = [];
  var feedResults = [];
  for (var i = 0; i < feeds.length; i++) {
    var feed = feeds[i];
    var result = { id: feed.id, name: feed.name, ok: true, error: null, count: 0 };
    try {
      var parsed = await fetchIcs(feed.url);
      var events = eventsFromParsedIcal(parsed, windowStart, windowEnd, timeZone, feed.id);
      allEvents = allEvents.concat(events);
      result.count = events.length;
    } catch (err) {
      result.ok = false;
      result.error = (err && err.message) ? err.message : String(err);
    }
    feedResults.push(result);
  }
  return { generatedAt: now.toISOString(), timezone: timeZone, feeds: feedResults, events: allEvents };
}

async function main() {
  var feedsPath = process.argv[2] || "data/ics-feeds.json";
  var outputPath = process.argv[3] || "data/ics-events.json";
  var timeZone = process.env.ICS_TIMEZONE || "Europe/Malta";

  var feeds = [];
  if (fs.existsSync(feedsPath)) {
    try { feeds = JSON.parse(fs.readFileSync(feedsPath, "utf8")); } catch (e) { feeds = []; }
  }
  if (!Array.isArray(feeds)) feeds = [];

  var output = await syncFeeds(feeds, { timeZone: timeZone });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log("Wrote " + output.events.length + " event occurrence(s) from " + feeds.length + " feed(s) to " + outputPath);
  output.feeds.forEach(function (f) {
    if (!f.ok) console.error("Feed \"" + f.name + "\" (" + f.id + ") failed: " + f.error);
  });
}

module.exports = { wallClock, expandEvent, occurrenceToFields, eventsFromParsedIcal, syncFeeds };

if (require.main === module) {
  main().catch(function (err) { console.error(err); process.exit(1); });
}
