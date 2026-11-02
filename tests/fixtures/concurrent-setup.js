import {createServer} from 'node:http';
import {once} from 'node:events';
import {writeFile} from 'node:fs/promises';
export default async({config})=>{
  let arrivals=[], drains=[];
  let both=Promise.withResolvers();
  let entered=Promise.withResolvers(),release=Promise.withResolvers();
  let closeAllowed=Promise.withResolvers();
  let drain=async({workerId,test})=>{
    drains.push({worker:workerId,name:test.name});
    if(test.name==='Reserved first'){entered.resolve();await release.promise;}
  };
  return {
    fixtures:{shared:'Shared immutable build'},
    drain,
    createWorker:async({worker})=>{
      let saved='';
      let registration=Promise.withResolvers();
      let server=createServer(async(request,response)=>{
        if(request.url==='/registration'){
          if(worker.id==='1'&&config.webServer.env.GATE!=='false')await registration.promise;
          response.end('registered');
        }else if(request.url==='/release-registration'){
          registration.resolve();response.end('released');
        }else if(request.url==='/drain-entered'){
          await entered.promise;response.end('draining');
        }else if(request.url==='/release-drain'){
          release.resolve();response.end('released');
        }else if(request.url==='/allow-close'){
          await closeAllowed.promise;response.end('close allowed');
        }else if(request.url==='/release-close'){
          closeAllowed.resolve();response.end('released');
        }else if(request.url==='/save'){
          let chunks=[];for await(let chunk of request)chunks.push(chunk);
          saved=Buffer.concat(chunks).toString();
          arrivals.push({worker:worker.id,name:saved});
          let pair=both;
          if(arrivals.length%2===0){both.resolve();both=Promise.withResolvers();}
          if(config.webServer.env.OVERLAP!=='false')await pair.promise;
          response.end(saved);
        }else{
          response.setHeader('Content-Type','text/html');
          response.end(`<!doctype html><style>body{margin:0;background:${worker.id==='0'?'#ff0000':'#0000ff'}}</style>
            <h1>Worker ${worker.id}</h1><label>Name<input name="name"></label><button>Save</button><p role="status"></p><button id="close-controller">Close test controller</button>
            <script>document.querySelector('button').onclick=async()=>{
              let response=await fetch('/save',{method:'POST',body:document.querySelector('input').value});
              document.querySelector('[role=status]').textContent='Saved '+await response.text();
            };document.querySelector('#close-controller').onclick=()=>window.open('',JSON.parse(window.name).controller).close();</script>`);
        }
      });
      server.listen(0,'127.0.0.1');await once(server,'listening');
      return {webServer:{url:'http://127.0.0.1:'+server.address().port,command:undefined,reuseExistingServer:true},
        fixtures:{worker:worker.id},
        drain:worker.id==='0'?drain:undefined,
        teardown:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
    },
    teardown:()=>writeFile('workers.json',JSON.stringify({arrivals,drains}))
  };
};
