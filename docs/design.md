# The reporter

The app gets the screen while tests run. The reporter helps you find a failure, read its output, and return to the app. Keep those tasks easy to see.

## Layout and behavior

- Group tests by file and suite on the overview. Keep summary, search, filters, and scoped reruns there.
- Give each test separate Output, Timings, and Application routes. Put details on those routes instead of adding panels to the overview.
- Keep slowest tests in a collapsed overview section. Put phases and inclusive operation timings on the test’s Timings route.
- Show failure text and source context before stack details. Keep console output and screenshots together.
- Use Show app to reveal the actual tested app. Don't replace it with a scaled preview or move it when navigating the reporter.
- Open inspection at a test boundary. Keep pause, continue, stop, and rerun actions clear about what happens next.
- Use stable test IDs in routes. Search and filters live in the URL and survive back/forward navigation.
- Show connection state and screenshot availability. A command stays pending until the test browser replies; show failures with a retry action.

## Visual style

Use the existing dark surfaces, thin dividers, and warm orange accent. Green, red, and yellow show test status; pair color with text or symbols. Keep rows spacious and avoid decorative cards or large empty preview areas.

Use system sans-serif for UI and monospace for code, logs, and timings. Keep buttons compact, focus rings visible, and mobile content readable without horizontal page scrolling. Use real buttons, links, labels, headings, and keyboard controls.

Copy should be brief and specific: Run failed, Show app, Screenshot unavailable. Explain a failure and the next useful step without hype.

## Source files

[reporter.css](../src/browser/reporter.css) defines colors, type, spacing, and responsive layouts. [reporter.html](../src/browser/reporter.html) and [reporter.js](../src/browser/reporter.js) define the views. [reporter-client.js](../src/browser/reporter-client.js) handles reporter navigation and messages; [host.css](../src/browser/host.css) and [shell.js](../src/browser/shell.js) keep the app and overlay separate.
