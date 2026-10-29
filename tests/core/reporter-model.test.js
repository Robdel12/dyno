import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reporterRoute,reporterHref,selectedTest,reporterGroups} from '../../src/browser/reporter.js';

test('reporter links preserve stable identity and search across navigation and reject malformed paths',()=>{
  let id=JSON.stringify(['tests/a.test.js','Contacts / archived','saves café']);
  let route={page:'test',id,tab:'app',query:'Rob & Co',filter:'failed'};
  assert.deepEqual(reporterRoute(reporterHref(route)),route);
  assert.equal(selectedTest({route,tests:[{id:'different',index:0},{id,index:99}]}).index,99);
  assert.equal(reporterRoute('#/tests/%ZZ/output').page,'missing');
  assert.equal(reporterRoute('#/tests/a/unknown').page,'missing');
  let overview=reporterRoute(reporterHref({...route,page:'overview'}));
  assert.equal(overview.query,route.query);assert.equal(overview.filter,'failed');
});

test('reporter grouping keeps repeated short names separate by file and suite without changing tests',()=>{
  let tests=Object.freeze([
    Object.freeze({file:'a.js',suites:Object.freeze(['Accounts']),name:'saves'}),
    Object.freeze({file:'b.js',suites:Object.freeze(['Accounts']),name:'saves'}),
    Object.freeze({file:'a.js',suites:Object.freeze(['Contacts']),name:'saves'})
  ]);
  let groups=reporterGroups(tests);
  assert.deepEqual(groups.map(group=>[group.file,group.suites.map(suite=>suite.path)]),[['a.js',[['Accounts'],['Contacts']]],['b.js',[['Accounts']]]]);
  assert.equal(groups[0].suites[0].tests[0],tests[0]);
  assert.equal(tests[1].file,'b.js');
});
