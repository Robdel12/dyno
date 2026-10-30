import assert from 'node:assert/strict';

let reset = async (app) => {
  await app.bringToFront();
  await app.evaluate(async () => {
    await window.evalI.click('Reset example');
  });
};
let rect = (app, selector) =>
  app.evaluate((selector) => {
    let { x, y, width, height } = document.querySelector(selector).getBoundingClientRect();
    return { x: x + scrollX, y: y + scrollY, width, height };
  }, selector);

export let cases = Object.freeze([
  {
    name: 'native Tab and Space workflow',
    async run({ app, fixture, invoke }) {
      await reset(app);
      let before = await (await fetch(fixture.origin + '/records', { cache: 'no-store' })).json();
      await app.evaluate(async () => {
        await window.evalI.find('Name').then.focus();
      });
      await invoke({ kind: 'key', key: 'Tab' });
      await app.evaluate(async () => {
        await window.evalI.assert(
          () => document.activeElement.id === 'notes',
          'Tab must focus Notes',
        );
      });
      await invoke({ kind: 'key', key: 'Tab' });
      await app.evaluate(async () => {
        await window.evalI.assert(
          () => document.activeElement.id === 'save',
          'Tab must focus Save',
        );
      });
      await invoke({ kind: 'key', key: 'Space' });
      await app.evaluate(async () => {
        await window.evalI.find('$(#saved)').text('Saved Robert');
      });
      let after = await (await fetch(fixture.origin + '/records', { cache: 'no-store' })).json();
      assert.equal(
        after.length,
        before.length + 1,
        'Native Space must persist exactly one new record',
      );
      assert.equal(after.at(-1).name, 'Robert');
    },
  },
  {
    name: 'real CSS hover and pointer exit',
    async run({ app, invoke }) {
      await reset(app);
      let box = await rect(app, '#hover');
      await invoke({ kind: 'pointer', x: box.x + box.width / 2, y: box.y + box.height / 2 });
      await app.evaluate(async () => {
        await window.evalI
          .find('$(#hover)')
          .then.assert(
            ({ $ }) =>
              $.dataset.hovered === 'true' &&
              getComputedStyle($).backgroundColor === 'rgb(20, 160, 80)',
            'Native pointer must change CSS and event state',
          );
      });
      await invoke({ kind: 'pointer', x: 0, y: 0 });
      await app.evaluate(async () => {
        await window.evalI
          .find('$(#hover)')
          .then.assert(
            ({ $ }) =>
              $.dataset.hovered === 'false' &&
              getComputedStyle($).backgroundColor === 'rgb(20, 60, 140)',
            'Pointer exit must restore CSS and event state',
          );
      });
    },
  },
  {
    name: 'real clipboard permission and copy',
    chromium: true,
    async run({ context, app, fixture, invoke }) {
      await reset(app);
      await context.clearPermissions();
      await invoke({
        kind: 'permissions',
        permissions: ['clipboard-read', 'clipboard-write'],
        origin: fixture.origin,
      });
      await app.evaluate(async () => {
        await window.evalI.click('Copy evaluation token');
        await window.evalI.find('$(#copied)').text('Copied');
      });
      assert.equal(
        await app.evaluate(() => navigator.clipboard.readText()),
        'Dyno evaluation token',
      );
    },
  },
  {
    name: 'virtual WebAuthn with actual credential and assertion',
    chromium: true,
    async run({ app, invoke }) {
      await reset(app);
      await invoke({ kind: 'authenticator' });
      try {
        let credential = await app.evaluate(async () => {
          let created = await navigator.credentials.create({
            publicKey: {
              challenge: crypto.getRandomValues(new Uint8Array(32)),
              rp: { id: 'localhost', name: 'Dyno evaluation' },
              user: {
                id: new Uint8Array([1, 2, 3, 4]),
                name: 'evaluation@example.test',
                displayName: 'Evaluation user',
              },
              pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
              authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
              attestation: 'none',
            },
          });
          let signed = await navigator.credentials.get({
            publicKey: {
              challenge: crypto.getRandomValues(new Uint8Array(32)),
              rpId: 'localhost',
              allowCredentials: [{ type: 'public-key', id: created.rawId }],
              userVerification: 'required',
            },
          });
          return {
            created: created.id,
            signed: signed.id,
            signature: signed.response.signature.byteLength,
            clientData: JSON.parse(new TextDecoder().decode(signed.response.clientDataJSON)),
          };
        });
        assert.ok(credential.created);
        assert.equal(credential.created, credential.signed);
        assert.ok(credential.signature > 0);
        assert.equal(credential.clientData.type, 'webauthn.get');
      } finally {
        await invoke({ kind: 'remove-authenticator' });
      }
    },
  },
  {
    name: 'app offline and recovery with a connected controller',
    chromium: true,
    async run({ app, controller, fixture, invoke }) {
      await reset(app);
      let before = fixture.statusReads();
      await invoke({ kind: 'offline', offline: true });
      try {
        assert.equal(await app.evaluate(() => navigator.onLine), false);
        await app.evaluate(async () => {
          await window.evalI.click('Load status');
          await window.evalI.find('$(#network)').text('Offline');
        });
        assert.equal(
          fixture.statusReads(),
          before,
          'Offline app request must not reach the server',
        );
        let connection = await controller.evaluate(
          async () =>
            await (
              await fetch('/status?probe=' + crypto.randomUUID(), { cache: 'no-store' })
            ).json(),
        );
        assert.equal(connection.status, 'Connected');
        assert.equal(connection.revision, before + 1);
      } finally {
        await invoke({ kind: 'offline', offline: false });
      }
      await app.evaluate(async () => {
        await window.evalI.click('Load status');
        await window.evalI.find('$(#network)').text('Connected');
      });
      assert.equal(fixture.statusReads(), before + 2);
    },
  },
  {
    name: 'below-fold tall element pixels without viewport changes',
    async run({ app, invoke }) {
      await reset(app);
      let before = await app.evaluate(() => {
        window.observedResizes = [];
        window.recordResize = () => window.observedResizes.push([innerWidth, innerHeight]);
        addEventListener('resize', window.recordResize);
        return { width: innerWidth, height: innerHeight, x: scrollX, y: scrollY };
      });
      try {
        let box = await rect(app, '#tall');
        assert.ok(box.y > before.height && box.height > before.height);
        let { value } = await invoke({ kind: 'capture', clip: box });
        assert.equal(value.width, 160);
        assert.equal(value.height, 1500);
        assert.deepEqual(value.bands, [
          [180, 40, 90, 255],
          [20, 160, 80, 255],
          [20, 60, 140, 255],
        ]);
        let after = await app.evaluate(async () => {
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
          return {
            width: innerWidth,
            height: innerHeight,
            x: scrollX,
            y: scrollY,
            resizes: window.observedResizes,
          };
        });
        assert.deepEqual(
          { width: after.width, height: after.height, x: after.x, y: after.y },
          before,
        );
        assert.ok(
          after.resizes.every(
            ([width, height]) => width === before.width && height === before.height,
          ),
        );
      } finally {
        await app.evaluate(() => removeEventListener('resize', window.recordResize));
      }
    },
  },
  {
    name: 'real reduced-motion media setting',
    async run({ app, invoke }) {
      await reset(app);
      await invoke({ kind: 'motion', value: 'reduce' });
      try {
        await app.evaluate(async () => {
          await window.evalI.assert(
            () =>
              matchMedia('(prefers-reduced-motion: reduce)').matches &&
              getComputedStyle(document.querySelector('#motion')).animationName === 'none',
            'Real media emulation must disable CSS animation',
          );
        });
      } finally {
        await invoke({ kind: 'motion', value: 'no-preference' });
      }
    },
  },
]);
