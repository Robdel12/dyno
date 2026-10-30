# Native browser features without remote tests

Vizzly has a few tests that need browser defaults: Tab order, Space activation, CSS hover, clipboard permissions, passkeys, and offline recovery. Synthetic events cannot preserve those outcomes. Ordinary interactions and assertions still belong in Interactor, in the browser.

## Decision

Extend the existing authenticated operation queue and owned Playwright worker. Send only explicit native operations through it. Keep selectors, DOM reads, convergence, and custom Interactors local. Do not expose Playwright Page, Locator, evaluation, or CDP to tests.

The smaller speed evaluator passed before implementation began. The complete Vizzly suite remains the final performance check; these numbers are not a whole-suite speedup.

## What we measured

Three independent spike lanes compared HTTP/IPC, a controller binding, and browser behavior. All timed runs were serial. Each transport used the same fixed evaluator, one warmup and 20 samples per scenario, Chromium 156.0.8078.4, Playwright Core 1.64.1, Node 24.22.1, and an Apple M4 Max.

The evaluator owns the clocks. The direct reference uses Node's clock; browser candidates measure their actual caller in the controller. Whole workflows also include preparation and validation. Raw samples, environment, and source fingerprints are saved in [the results folder](../../benchmarks/managed/results/).

| Native call | Direct median | HTTP median / p95 | Binding median / p95 |
| --- | ---: | ---: | ---: |
| Key | 2.23 ms | 13.7 / 16.6 ms | 2.2 / 4.7 ms |
| Pointer | 12.18 ms | 13.1 / 17.3 ms | 12.3 / 16.2 ms |
| Permissions | 1.01 ms | 1.6 / 4.1 ms | 1.5 / 3.0 ms |
| Authenticator | 0.41 ms | 1.4 / 1.6 ms | 0.8 / 1.0 ms |
| Offline | 0.73 ms | 3.0 / 5.9 ms | 2.4 / 4.0 ms |
| Tall element capture | 39.48 ms | 39.7 / 45.7 ms | 39.3 / 42.9 ms |
| Reduced motion | 0.93 ms | 2.1 / 4.0 ms | 1.3 / 2.7 ms |

All three passed the seven native scenarios and both local Interactor controls. HTTP's local controls were 249.3 / 248.5 ms, versus the reference's 252.7 / 249.5 ms. Small differences between separate runs are noise. The keyboard cost remains visible; we have not isolated its source.

HTTP's prototype used an extra IPC round trip and a second port with CORS. Production reuses Dyno's existing same-origin gateway and worker. This was a conservative transport experiment, not a measurement of shipped code. Capture checks covered actual pixels in a below-fold 1500 px element, unchanged viewport/scroll, and CSS that would reveal temporary resizing. The evaluator also verified fresh HTTP persistence, real credential creation/assertion, and cleanup failures.

## Why the binding lost

The binding was faster for keys, but duplicated execution ownership between the gateway and SDK callbacks. Playwright also added two support globals to the app even with a controller-only custom binding.

An opener ElementHandle was another trap: it reported the app as its owning frame and completed hover without error, while the app's CSS remained unhovered. Explicit coordinates dispatched through the retained app page worked. Tests must resolve targets with Interactor and verify actual behavior.

## Browser limits

Chromium and WebKit proved native Tab, Space, and CSS hover. Synthetic Space saved zero records; native Space saved exactly one. Firefox's disposable probe could not read its profile under the Codex sandbox; this was not an unsandboxed launch test or evidence that Firefox input is unsupported. The later unsandboxed integration run reproduced that launch failure. Chromium passed all six native workflows and the full 124-test Dyno suite; WebKit passed five native workflows with the Chromium-only case explicitly excluded. The later pinned Linux reproduction passed Firefox’s five supported workflows; local macOS startup remains blocked as described below.

Context-wide offline breaks the companion's reporting connection. Chromium page-targeted CDP offline preserves fresh companion HTTP, but also changes its navigator.onLine value. It isolates request transport, not every browser online-state signal. WebAuthn and this offline feature require Chromium. Clipboard permissions vary by engine; unsupported requests must fail clearly.

A top-level data: document loses the same-origin app binding. A sandboxed form preserves the top-level app while still sending a real Origin: null POST. Vizzly's port needs an app-owned fixture and an observable server result to preserve that security case; a Node fetch with a forged header is not equivalent.

## Implementation boundaries

Native requests carry run, execution, document, viewport, and request IDs. Admission checks happen before dispatch through the original app page. Keys can intentionally navigate within their execution; screenshots and geometry stay tied to their original document. Cancellation rejects queued work and late results, but cannot undo input already delivered.

Permissions, media, network state, and authenticators reset before the next test. Failed cleanup ends the managed session. Run replacement and shutdown also release owned state. Manual browsers keep URL-only execution and report native features as unavailable. A failed native reset must still deliver and save a terminal failure; ending the worker cannot leave the CLI waiting for its run deadline. Real gateway/browser regressions cover both an existing fatal result and successful tests whose final cleanup fails.

Native Interactor actions compose with custom definitions. Each managed call gets a first-class timing entry. Element images use the existing screenshot preparation, validation, staging, and publication path. Locale and time zone belong in managed context configuration.

Implementation checks must exercise real CLI/browser workflows: native defaults and CSS, deliberate navigation, stale elements, exact tall-image pixels, manual rejection, configured locale/time zone, cleanup across tests, and saved native timings. After those pass, port all 339 Vizzly cases before making any speed claim.

## CI findings

CI exposed host assumptions in the tests: media cleanup must restore the actual initial preference, not assume reduced motion was off; localhost must bind consistently for Node and browser clients.

Firefox's native Space really did click and submit. The form POST returned 200 and its DOM updated, but the hidden companion's one-second timer clamping could exhaust Interactor's two-second retry budget before its reliability check. A clean Docker reproduction passed unchanged tests after applying the same three background-timer preferences used by Playwright's Firefox BiDi defaults. Managed Firefox now uses those preferences. Reliability and test budgets remain unchanged. The complete native workflow file passed five cases with one explicit Chromium-only exclusion in 8.40 seconds. Local macOS Firefox still has the separate profile launch failure described above.

Media restoration needed one more fix: resetting Playwright media to null can select the OS preference rather than the app's initial managed preference. The provider now captures and restores the actual initial value. A forced Chromium host preference reproduced the old failure and passed with the fix, using unchanged assertions and budgets; that case is permanent coverage.

Native features have their own complete engine suite in CI, alongside browser and capture suites. Every job retains its five-minute cap. This keeps a growing set of driver capability workflows from exhausting the general browser cohort's budget; product test execution remains sequential.
