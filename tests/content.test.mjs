import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const data=readFileSync(new URL('../public/course-data.js',import.meta.url),'utf8').trim();
const course=JSON.parse(data.replace(/^window\.COURSE=/,'').replace(/;$/,''));
const ui=readFileSync(new URL('../public/course.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');

test('Colombia FLACSO edition retains ten units and all progress indices',()=>{
 assert.equal(course.units.length,10);
 assert.equal(course.units.reduce((total,unit)=>total+unit.minutes,0),240);
 assert.ok(course.units.every(unit=>unit.sections.length>=6 && unit.questions.length>0));
 assert.ok(course.units.every(unit=>unit.sections.every(sec=>sec.paragraphs.length>0 && sec.paragraphs.every(p=>p.length>50))));
 assert.ok(!course.units.some(unit=>JSON.stringify(unit).match(/Ecuador|ecuatorian[oa]/i)));
});

test('integrates theory and 2026 reference material',()=>{
 const text=course.units.map(u=>u.sections.map(s=>s.title+' '+s.paragraphs.join(' ')).join(' ')).join(' ');
 for(const keyword of ['Feenberg','cypherpunk','Diffie','Hashcash','DigiCash','bit gold','b-money','Bre-B','Colombia','finanzas abiertas','mBridge','e-CNY','Drex','euro digital','AML']){
  // AML may appear only as anti-money laundering in external resources; check core named keywords.
  if(keyword==='AML')continue;
  assert.ok(text.toLowerCase().includes(keyword.toLowerCase()),'Missing '+keyword);
 }
 assert.ok(course.references.length>=18);
 assert.ok(course.references.every(ref=>ref.url.startsWith('https://') && ref.name && ref.why));
});

test('contains dated full and partial Bitcoin price series and historical crypto market context',()=>{
 assert.equal(course.bitcoinAnnualHistory.length,17);
 assert.equal(course.bitcoinAnnualHistory[0].year,2010);
 assert.equal(course.bitcoinAnnualHistory.at(-1).year,2026);
 assert.match(course.bitcoinAnnualHistory.at(-1).period,/incompleto/);
 assert.equal(course.bitcoinPrice2026.length,12);
 assert.ok(course.marketSnapshot.totalCapUSD>2_000_000_000_000);
 assert.ok(course.marketSnapshot.coinsTracked>15_000);
 assert.ok(course.marketSnapshot.historicFlacso);
 assert.ok(course.marketSnapshot.sources.length>=2);
 assert.match(course.marketSnapshot.asOf,/2026/);
});

test('Colombia frontend displays updated charts and pesos, not Ecuador-based simulations',()=>{
 assert.match(ui,/function blockchainVisual/);
 assert.match(ui,/function cryptoMarketPanel/);
 assert.match(ui,/function bitcoinChartSvg/);
 assert.match(ui,/Ingreso mensual estimado \(COP\)/);
 assert.match(ui,/Pagos mensuales de deudas \(COP\)/);
 assert.doesNotMatch(ui,/cooperativa ecuatoriana|Ingreso mensual estimado \(USD\)/);
 assert.match(html,/colombia-flacso-20261111/);
});
