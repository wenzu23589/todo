const { buildDigest } = require("../scripts/send-digest.js");

function task(text, due, extra) {
  return Object.assign({ text: text, done: false, due: due, archivedAt: null }, extra || {});
}

function main() {
  var now = new Date("2026-08-26T10:00:00Z"); // a Wednesday
  var state = {
    headings: [
      { title: "Work", tasks: [
        task("Overdue report", { date: "2026-08-20" }),
        task("Due today meeting", { date: "2026-08-26", time: "14:00" }),
        task("Due soon review", { date: "2026-08-28" }),
        task("Far future planning", { date: "2026-09-30" }),
        task("Done already", { date: "2026-08-20" }, { done: true }),
        task("Archived overdue", { date: "2026-08-19" }, { done: true, archivedAt: "2026-08-21T00:00:00Z" }),
        task("No due date", null)
      ], subheadings: [
        { title: "Sub", tasks: [ task("Sub overdue", { date: "2026-08-25" }) ] }
      ] }
    ]
  };

  // Off by default
  var offResult = buildDigest(state, { enabled: false, email: "lawrence@example.com" }, now);
  console.log("Returns null when disabled:", offResult === null ? "PASS" : "FAIL");

  // No email configured
  var noEmailResult = buildDigest(state, { enabled: true, email: "" }, now);
  console.log("Returns null when no recipient email:", noEmailResult === null ? "PASS" : "FAIL");

  // Enabled, with recipient
  var d = buildDigest(state, { enabled: true, email: "lawrence@example.com" }, now);
  console.log("Returns a digest when enabled with a recipient:", d ? "PASS" : "FAIL");
  console.log("Counts overdue correctly (2: report + sub):", d.counts.overdue === 2 ? "PASS" : "FAIL (" + d.counts.overdue + ")");
  console.log("Counts due-today correctly (1):", d.counts.dueToday === 1 ? "PASS" : "FAIL (" + d.counts.dueToday + ")");
  console.log("Counts due-soon correctly (1, within 3 days):", d.counts.dueSoon === 1 ? "PASS" : "FAIL (" + d.counts.dueSoon + ")");
  console.log("Excludes done tasks:", d.text.indexOf("Done already") === -1 ? "PASS" : "FAIL");
  console.log("Excludes archived tasks:", d.text.indexOf("Archived overdue") === -1 ? "PASS" : "FAIL");
  console.log("Excludes tasks with no due date:", d.text.indexOf("No due date") === -1 ? "PASS" : "FAIL");
  console.log("Excludes far-future tasks from due-soon:", d.text.indexOf("Far future planning") === -1 ? "PASS" : "FAIL");
  console.log("Includes overdue task text:", d.text.indexOf("Overdue report") !== -1 ? "PASS" : "FAIL");
  console.log("Includes sub-heading task with its location:", /Sub overdue.*Work.*Sub/.test(d.text.replace(/\n/g, " ")) ? "PASS" : "FAIL");
  console.log("Subject mentions the total count (4):", /\b4 task/.test(d.subject) ? "PASS" : "FAIL (" + d.subject + ")");
  console.log("HTML includes escaped task text:", d.html.indexOf("Overdue report") !== -1 ? "PASS" : "FAIL");

  // All-clear case
  var clearState = { headings: [{ title: "Work", tasks: [ task("Far off", { date: "2026-12-01" }) ], subheadings: [] }] };
  var clearDigest = buildDigest(clearState, { enabled: true, email: "lawrence@example.com" }, now);
  console.log("All-clear subject when nothing is due:", /nothing due today/i.test(clearDigest.subject) ? "PASS" : "FAIL (" + clearDigest.subject + ")");
}
main();
