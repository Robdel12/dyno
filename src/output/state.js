// Shared bookkeeping for the reporters. Each reporter is a reducer:
// step(state, event, context) returns { state, writes }, where writes are
// [stream, text] pairs that only src/cli-output.js puts on a stream.

export let out = (lines) => lines.map(text => ['out', text]);
export let err = (lines) => lines.map(text => ['err', text]);

export let withRun = (state, runId, empty, change) => {
  let run = state.runs[runId] ?? empty;
  return { ...state, runs: { ...state.runs, [runId]: { ...run, ...change(run) } } };
};

// Finished runs leave state, so long watch sessions don't accumulate results.
export let withoutRun = (state, runId) => {
  let { [runId]: finished, ...runs } = state.runs;
  return { ...state, runs };
};
