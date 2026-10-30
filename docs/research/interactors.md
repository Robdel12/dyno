# Composable interactors

We checked the installed Interactor.js 3.6.2 source, especially [Interactor](https://github.com/wwilsman/interactor.js/blob/main/lib/interactor.js), [contexts](https://github.com/wwilsman/interactor.js/blob/main/lib/context.js), and [interaction execution](https://github.com/wwilsman/interactor.js/blob/main/lib/interact.js). These links follow upstream main; Dyno pins the version it runs.

Interactor already owns custom actions, assertions, reusable chains, and convergence. Its static `defineActions` and `defineAssertions` methods register extensions on prototypes. Subclasses isolate actions, but assertions also need their own `Assert` subclass to avoid changing siblings.

Dyno adds `defineInteractor({ actions, assertions })`. It creates that private definition once and returns a binding function:

```js
let post = Post(I, postSelector(words));
let reply = Composer(post, '$([aria-label="Reply"])');
await reply.write('I remember this storm.');
```

Binding copies the parent scope's root resolver, assertion settings, and signal into an independent Interactor. Roots resolve again after app navigation. Definitions and derived chains don't change the caller or siblings. This is an immutable authoring API around Interactor's existing execution contexts; it doesn't freeze upstream internals.

## Compose with async actions

Prefer async actions with explicit awaits for forms and child components. Native generators share the current subject across yielded work. In a real-browser probe, nesting a generator that filled Name before another field caused the later operation to target the wrong field. Returning another chain from the outer action also retained unexpected selection state. Independent awaited operations selected the intended fields.

Generators remain available for deliberate subject-based actions. Dyno doesn't replace Interactor's execution loop to hide that distinction. The browser contract exercises generator actions, async composition, sibling definitions, reusable chains, nested scopes, missing roots, and navigation. An installed TypeScript consumer checks custom method arguments, assertions, and chains.

## Project boundaries

Tornadic's forms, posts, and composers are custom interactors. Workflow functions keep app navigation, named timing steps, fixture I/O, and screenshot publication. Domain selectors stay in the project. No driver commands or messages are added for interactions.
