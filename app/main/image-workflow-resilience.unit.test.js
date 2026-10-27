const assert = require('assert');
const { createImageWorkflow } = require('./image-workflow');

(async () => {
  const provider = { baseUrl:'http://localhost', model:'before', multimodal:true, apiKey:'' };
  const image = Buffer.from('original');
  let release, captured, writes = [];
  const common = { getProvider:()=>provider, getProviderStatus:()=>provider, hasImage:()=>true,
    readImage:()=>image, isConflicting:()=>false, capture:async()=>({ok:true}), writeText:text=>writes.push(text) };
  const workflow = createImageWorkflow({...common, transcribeImage:(p,png)=>{captured={p,png};return new Promise(resolve=>{release=resolve;});}});
  const pending=workflow.recognize(); provider.model='after'; image.fill(0);
  assert.equal(captured.p.model,'before'); assert.equal(captured.png.toString(),'original');
  release('    preserved'); await pending; assert.deepEqual(writes,['    preserved']);
  const brokenObserver=createImageWorkflow({...common,onState:()=>{throw Error('closed UI');},transcribeImage:async()=>'body'});
  assert.equal((await brokenObserver.runScreenshot()).ok,true); assert.equal(brokenObserver.busy,false);
  const badCapture=createImageWorkflow({...common,capture:async()=>{throw Error('capture unavailable');},transcribeImage:async()=>'body'});
  assert.equal((await badCapture.runScreenshot()).ok,false); assert.equal(badCapture.busy,false);
  const badClipboard=createImageWorkflow({...common,hasImage:()=>{throw Error('clipboard locked');},readImage:()=>{throw Error('clipboard locked');},transcribeImage:async()=>{throw Error('must not call');}});
  assert.equal(badClipboard.state().eligible,false); assert.equal((await badClipboard.recognize()).ok,false); assert.equal(badClipboard.busy,false);
  const conflicting=createImageWorkflow({...common,isConflicting:()=>true,transcribeImage:async()=>'body'});
  assert.equal(conflicting.state().canScreenshot,false); assert.equal((await conflicting.runScreenshot()).reason,'busy');
  console.log('PASS image workflow owns snapshots and recovers from clipboard, observer and capture failures');
})().catch(error=>{console.error(error);process.exitCode=1;});
