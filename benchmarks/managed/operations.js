import { PNG } from 'pngjs';

// This is the reference evaluator, not a shipped Dyno browser API.
export function createOperations({ context, app, engine }) {
  let session;
  let authenticator;
  let cdp = async () => {
    if (engine !== 'chromium')
      throw Object.assign(new Error('This reference requires Chromium CDP.'), {
        code: 'UNSUPPORTED',
      });
    session ??= await context.newCDPSession(app);
    return session;
  };
  return async (input) => {
    switch (input.kind) {
      case 'key':
        await app.keyboard.press(input.key);
        return null;
      case 'pointer':
        await app.mouse.move(input.x, input.y);
        return null;
      case 'permissions':
        await context.grantPermissions(input.permissions, { origin: input.origin });
        return null;
      case 'authenticator': {
        let client = await cdp();
        await client.send('WebAuthn.enable');
        ({ authenticatorId: authenticator } = await client.send(
          'WebAuthn.addVirtualAuthenticator',
          {
            options: {
              protocol: 'ctap2',
              transport: 'internal',
              hasResidentKey: true,
              hasUserVerification: true,
              isUserVerified: true,
              automaticPresenceSimulation: true,
            },
          },
        ));
        return authenticator;
      }
      case 'remove-authenticator': {
        if (authenticator)
          await (await cdp()).send('WebAuthn.removeVirtualAuthenticator', {
            authenticatorId: authenticator,
          });
        authenticator = undefined;
        return null;
      }
      case 'offline': {
        let client = await cdp();
        await client.send('Network.enable');
        await client.send('Network.emulateNetworkConditions', {
          offline: input.offline,
          latency: 0,
          downloadThroughput: -1,
          uploadThroughput: -1,
        });
        return null;
      }
      case 'capture': {
        let bytes = await app.screenshot({
          clip: input.clip,
          fullPage: true,
          animations: 'disabled',
          caret: 'hide',
        });
        let image = PNG.sync.read(bytes);
        let pixel = (y) => [...image.data.subarray(y * image.width * 4, y * image.width * 4 + 4)];
        return {
          width: image.width,
          height: image.height,
          pixel: pixel(0),
          bands: image.height >= 1500 ? [pixel(10), pixel(600), pixel(1200)] : [],
        };
      }
      case 'motion':
        await app.emulateMedia({ reducedMotion: input.value });
        return null;
      default:
        throw new Error(`Unknown evaluation operation: ${input.kind}`);
    }
  };
}
