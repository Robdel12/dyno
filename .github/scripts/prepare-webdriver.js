import { binaryPaths } from 'selenium-webdriver/common/seleniumManager.js';
import { resolveBrowser } from '../../src/launcher.js';

let name = process.env.DYNO_CAPTURE_BROWSER ?? 'chrome';
let browser = await resolveBrowser({ name });
let paths = binaryPaths([
  '--browser', name,
  '--browser-path', browser.path,
  '--avoid-browser-download',
  '--timeout', '120',
  '--language-binding', 'javascript',
  '--output', 'json'
]);
console.log(JSON.stringify({ browser: name, ...paths }));
