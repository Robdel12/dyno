import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createBrowserSession, resolveSession } from '../../src/browser-session.js';
import { repository } from './project.js';

export async function inspectOfflineReport(t, path, browser, { images = 0, timings = false, interruptedOutput } = {}) {
  let result = Promise.withResolvers();
  let server = createServer(async (request, response) => {
    let chunks = [];
    for await (let chunk of request) chunks.push(chunk);
    try {
      result.resolve(JSON.parse(Buffer.concat(chunks).toString()));
    } catch (error) {
      result.reject(error);
    }
    response.end('received');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  let aborted = () => result.reject(t.signal.reason);
  t.signal.addEventListener('abort', aborted, { once: true });
  t.after(() => t.signal.removeEventListener('abort', aborted));
  let script = await build({
    stdin: {
      contents: `
    import {Interactor} from 'interactor.js';
    (async()=>{let UI=new Interactor({root:()=>document.body});
    let step='heading';
    try{
      await UI.find('$(.saved-report h1)').visible();
      step='xml';
      let xml = new DOMParser().parseFromString(${JSON.stringify(await readFile(join(dirname(path), 'junit.xml'), 'utf8'))},'application/xml');
      await UI.assert(()=>!xml.querySelector('parsererror') && !!xml.querySelector('testsuites'),'JUnit is not valid XML');
      await UI.assert(()=>document.querySelectorAll('.screenshot img').length===${images},'Wrong screenshot count');
      for (let image of document.images) {
        let detail=image.closest('details.saved-test');
        if(!detail.open)await UI.click(detail.querySelector('summary'));
        image.scrollIntoView({block:'center'});
        await UI.assert(()=>image.complete && image.naturalWidth>0,'Offline PNG did not load');
      }
      await UI.assert(()=>[...document.images].every(image=>image.complete && image.naturalWidth>0),'Offline PNG did not load');
      await UI.assert(()=>!window.injectedReportCode && !document.querySelector('script[data-untrusted]'),'Report content executed as HTML');
      ${interruptedOutput ? `step='interrupted output';
      await UI.click('$(.saved-test[data-status="not-run"] summary)');
      await UI.assert(()=>document.querySelector('.saved-test[data-status="not-run"] pre').innerText.includes(${JSON.stringify(interruptedOutput)}),'Interrupted output is missing');
      await UI.find('$(.saved-test[data-status="not-run"] pre)').visible();` : ''}
      ${timings ? `step='timings';
      await UI.click('$(.saved-test summary)');
      await UI.click('$(.saved-test .saved-timings summary)');
      await UI.find('$(.saved-test .saved-timings)').contains('Save <contact>');
      await UI.find('$(.saved-test .saved-timings)').contains('Setup hook');
      await UI.assert(()=>!document.querySelector('contact'),'Timing content executed as markup');` : ''}
      step='search';
      await UI.type('no matching test phrase').into('$(#search)');
      await UI.find('No tests match this filter.').visible();
      await UI.find('$(#search)').then.press('Delete',{replace:true});
      await UI.assert(()=>[...document.querySelectorAll('[data-test]')].some(test=>!test.hidden),'Clearing search did not restore tests');
      await fetch('http://127.0.0.1:${server.address().port}',{method:'POST',mode:'no-cors',body:JSON.stringify({ok:true,images:document.images.length,overflow:document.documentElement.scrollWidth>innerWidth})});
    }catch(error){await fetch('http://127.0.0.1:${server.address().port}',{method:'POST',mode:'no-cors',body:JSON.stringify({error:error.message,step,heading:document.querySelector('h1')?.outerHTML,stack:error.stack})});}
    })();
  `,
      resolveDir: repository
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    logLevel: 'silent'
  });
  // The report itself stays untouched. This adjacent copy adds browser-local verification only.
  let inspection = join(dirname(path), 'verification.html');
  await writeFile(
    inspection,
    (await readFile(path, 'utf8')).replace(
      '</body>',
      () => `<script type="module">${script.outputFiles[0].text}</script></body>`
    )
  );
  let session = await createBrowserSession(await resolveSession(browser), {
    viewport: { width: 390, height: 844 },
    signal: t.signal,
    onExit: () => result.reject(new Error('Offline browser closed before inspection.'))
  });
  t.after(session.stop);
  await session.open(pathToFileURL(inspection).href);
  return result.promise;
}
