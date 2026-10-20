// Journal
// =======
// The server's own words, as lines an operator reads and a machine can
// parse: `unii: <level>: <what>` on stderr, or one JSON object a line when
// `UNII_LOG=json` (`{ at, level, what }`).
//
// What this file is not:
//
// - Not a message to a person. A person's answer, a failure they should see,
//   is the view's (`Chat.note`, an `error` message), never the log: the log
//   speaks of the server's account, the model's health and a store's files,
//   which are not theirs to read.
// - Not a rotator. A process cannot safely rename its own open stderr; the
//   supervisor's stderr goes to whatever started it (`unii serve 2>> unii.log`
//   under newsyslog, logrotate, or a container runtime), and that is where
//   rotation belongs. `Doctor` reports the store's size, not the log's.
//
// Levels are three, because there are three things an operator does: read it
// (info), watch it (warn), act on it (error).

export namespace Journal {

  export type Level = "info" | "warn" | "error";

  // a line as it will be printed (`json`: one object, for a collector)
  export function format(level: Level, what: string, json = JSON_LINES): string {
    return json ? JSON.stringify({ at: new Date().toISOString(), level, what }) : "unii: " + level + ": " + what;
  }

  export function write(level: Level, what: string): void {
    // stderr, always: stdout is the terminal's own output (`Term.ts`), and a
    // pipe that mixes the two is useless
    console.error(Journal.format(level, what));
  }

  // a line for the operator's eyes, not a log: a sign-in link is a
  // credential, and the journal's own advice is to rotate it to a file. It
  // goes to stdout, where a person is already looking.
  export function person(text: string): void {
    console.log(text);
  }

  export function info(what: string): void {
    Journal.write("info", what);
  }

  export function warn(what: string): void {
    Journal.write("warn", what);
  }

  export function error(what: string): void {
    Journal.write("error", what);
  }

}

export const JSON_LINES = process.env.UNII_LOG === "json";
