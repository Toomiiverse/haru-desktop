// One line per phone or Discord turn, with the numbers that explain its speed.
//
// Every message from outside the desk gets a trace id, and the stages she passes
// through are stamped with wall-clock times. The whole thing is written out as a
// single [trace] line — a phone answer that was slow leaves a line saying which
// stage was slow, which is the difference between knowing "a reply took 5s" and
// knowing the model was the 4.5s of it.
//
// Stage names are the caller's choice; this module only keeps them in order.
// The convention in main.ts: intent (routing decision), first (time to first
// token / chunk), reply (whole reply assembled).

let counter = 0;

export type Trace = {
  id: string;
  /** Stamp a stage. Call once per stage; repeated names keep the first stamp. */
  mark(stage: string): void;
  /** Take a stamp back — used when a round that had already shown words is
   *  thrown away, so the trace does not claim a first word that never stood. */
  unmark(stage: string): void;
  /** Write the line: id, source, every stamped stage as ms from the start. */
  done(source: string, extra?: Record<string, string | number>): void;
};

/** A trace id short enough to read on a phone's screenshot of a log. */
export function newTrace(): Trace {
  // The time is the searchable part, the counter keeps same-millisecond messages
  // apart, and the random tail stops an id being a way to count messages.
  const id = Date.now().toString(36) + '.' + (counter++ % 36).toString(36) + Math.random().toString(36).slice(2, 4);
  const started = Date.now();
  const marks: Record<string, number> = {};
  return {
    id,
    mark(stage) {
      if (!(stage in marks)) marks[stage] = Date.now();
    },
    unmark(stage) {
      delete marks[stage];
    },
    done(source, extra = {}) {
      const stages = Object.entries(marks).map(([stage, at]) => `${stage}=${at - started}ms`).join(' ');
      const rest = Object.entries(extra).map(([key, value]) => `${key}=${value}`).join(' ');
      console.log(`[trace] ${source} ${id}${stages ? ` ${stages}` : ''}${rest ? ` ${rest}` : ''}`);
    },
  };
}
