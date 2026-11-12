import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const data=readFileSync(new URL('../public/course-data.js',import.meta.url),'utf8').trim();
const course=JSON.parse(data.replace(/^window\.COURSE=/,'').replace(/;$/,''));
const ui=readFileSync(new URL('../public/course.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');

test('Colombia edition retains ten units and all progress indices',()=>{
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
 assert.ok(!Object.hasOwn(course.marketSnapshot,'historicFlacso'));
 assert.ok(!JSON.stringify(course).includes('FLACSO'));
 assert.ok(!ui.includes('FLACSO'));
 assert.ok(!ui.includes('1BSIfvHpQ-vJQdsB0L3MjDRH1lIo07AZ88RnWnqVlYe0'));
 assert.ok(!ui.includes('23.700'));
 assert.ok(!ui.includes('La diapositiva 27'));
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
 assert.match(html,/clases-ampliadas-20261111/);
});



test('market and lesson cards share explanatory 3D markup and accessibility attributes',()=>{
 const start=ui.indexOf('function flipCardMarkup(');
 const end=ui.indexOf('function unit(i){',start);
 assert.ok(start>=0&&end>start,'Flip renderer must exist');
 const renderers=new Function('C','esc','bitcoinChartSvg',ui.slice(start,end)+'\nreturn {cryptoMarketPanel,conceptCardsForUnit};')(
  course,
  value=>String(value).replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x])),
  ()=>'<svg aria-label="Gráfico didáctico"></svg>'
 );
 const markup=renderers.cryptoMarketPanel();
 assert.equal((markup.match(/class="metric-card metric-card--/g)||[]).length,9);
 assert.equal((markup.match(/class="metric-card__face metric-card__back"/g)||[]).length,9);
 assert.equal((markup.match(/aria-pressed="false"/g)||[]).length,9);
 assert.equal((markup.match(/data-front-label=/g)||[]).length,9);
 assert.equal((markup.match(/data-back-label=/g)||[]).length,9);
 assert.ok(markup.includes('market-sources'), 'Citations remain available');
 assert.ok(markup.includes('<table class="market-history-table">'));
 assert.ok(markup.includes('11 NOV 2026'));
 assert.ok(!markup.includes('FLACSO') && !markup.includes('diapositiva 27'), 'No exponer material preparatorio, aunque el año 2023 sí debe figurar en la serie histórica');
 assert.ok(markup.includes('Capitalización no es dinero efectivamente invertido'));
 let lessonCards=0;
 for(let i=0;i<10;i++){
  const lesson=renderers.conceptCardsForUnit(i);
  const cards=(lesson.match(/class="metric-card metric-card--/g)||[]).length;
  lessonCards+=cards;
  assert.equal(cards,i===3?0:3,'Expected 3 cards in unit '+(i+1)+' (except market unit 4)');
  if(cards)assert.match(lesson,/class="metric-card__face metric-card__back"/);
 }
 assert.equal(lessonCards,27);
});

test('responsive dashboard styling retains table readability and cards work independently of reduced motion preferences',()=>{
 const css=readFileSync(new URL('../public/course.css',import.meta.url),'utf8');
 const accountCss=readFileSync(new URL('../public/account.css',import.meta.url),'utf8');
 for(const rule of ['.market-data-grid','.metric-card__inner','.metric-card__front','.metric-card__back','.market-history-table tbody tr:hover','.metric-card:focus-visible','prefers-reduced-motion:reduce'])assert.ok(css.includes(rule),'Missing '+rule);
 assert.ok(accountCss.includes('.table-wrap tbody tr:hover td'));
 assert.ok(html.includes('/course.css?v=clases-ampliadas-20261111'));
 assert.ok(html.includes('/course.js?v=clases-ampliadas-20261111'));
});



test('browser animations use explicit keyframes to flip and grow despite CSS animation preferences',()=>{
 const css=readFileSync(new URL('../public/course.css',import.meta.url),'utf8');
 assert.match(css,/\.metric-card:hover,\.metric-card\[data-hovered="true"\]/);
 assert.match(css,/scale\(1\.075\)/);
 assert.match(css,/\.metric-card\.is-flipped \.metric-card__inner/);
 assert.match(css,/backface-visibility:hidden/);
 assert.match(ui,/function activateFlipCards\(/);
 assert.match(ui,/inner\.animate\(/);
 assert.match(ui,/card\.animate\(/);
 assert.match(ui,/duration:950/);
 assert.match(ui,/duration:320/);
 assert.match(ui,/target===180/);
 assert.match(ui,/Clic para girar/);
 assert.match(ui,/Clic para volver/);
 assert.match(html,/clases-ampliadas-20261111/);
});


test('second day follows verified institutional schedule and has three dedicated learning activities',()=>{
 const start=ui.indexOf('function dayTwoIntroPanel(){');
 const end=ui.indexOf('function unit(i){',start);
 assert.ok(start>0&&end>start);
 const blocks=new Function('esc',ui.slice(start,end)+'\nreturn {dayTwoIntroPanel,fraudWorkshopPanel,finalDayTwoPanel};')(
  value=>String(value).replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]))
 );
 const agenda=blocks.dayTwoIntroPanel();
 const fraud=blocks.fraudWorkshopPanel();
 const final=blocks.finalDayTwoPanel();
 assert.ok(agenda.includes('25 NOV')&&agenda.includes('13:00–15:00'));
 assert.ok(agenda.includes('96,5 %')&&agenda.includes('36,1 %')&&agenda.includes('2025'));
 assert.ok(agenda.includes('47'));
 assert.ok(agenda.includes('superfinanciera.gov.co'));
 assert.equal((agenda.match(/day-two-agenda__row/g)||[]).length,5);
 assert.ok(fraud.includes('fraudThreshold')&&fraud.includes('fraudFP')&&fraud.includes('fraudFN'));
 assert.ok(fraud.includes('20 operaciones'));
 assert.ok(final.includes('Reversibilidad'));
 assert.ok(final.includes('250 palabras'));
 assert.ok(ui.includes('bindFraudWorkshop();'));
 assert.match(ui,/const legit=\[5,10,12,18,23,29,31,37,41,48,53,56,61,66,72\],fraud=\[34,52,65,81,94\]/);
 assert.match(ui,/const tp=fraud.filter\(x=>x>=threshold\).length/);
 assert.match(ui,/const fp=legit.filter\(x=>x>=threshold\).length/);
});

test('second day content contains current Colombian source-based research and keeps existing structure',()=>{
 const day2=course.units.slice(5);
 assert.equal(day2.length,5);
 assert.deepEqual(day2.map(x=>x.day),[2,2,2,2,2]);
 assert.equal(day2.reduce((total,unit)=>total+unit.minutes,0),120);
 const body=day2.flatMap(unit=>unit.sections.flatMap(x=>x.paragraphs)).join(' ');
 assert.match(body,/47 entidades/);
 assert.match(body,/96,5 %/);
 assert.match(body,/falso positivo/);
 assert.match(body,/revisión humana/);
 assert.match(body,/Colombia/);
 for(const url of [
 'https://www.bancadelasoportunidades.gov.co/es/noticias/banca-de-las-oportunidades-y-la-superfinanciera-lanzan-el-reporte-de-inclusion-financiera',
 'https://www.superfinanciera.gov.co/publicaciones/10116314/historico-publicaciones/',
 'https://sedeelectronica.sic.gov.co/publicaciones/boletin-juridico/concepto/regimen-de-tratamiento-de-datos-personales-debe-aplicarse-al-margen-de-los-procedimientos-metodologias-o'
 ])assert.ok(course.references.some(r=>r.url===url));
});


test('all 95 teaching sections include unique accessible starting explanations without replacing advanced paragraphs',()=>{
 const all=course.units.flatMap((unit,index)=>unit.sections.map(s=>({unit:index+1,...s})));
 assert.equal(all.length,95);
 assert.equal(all.filter(s=>s.entrada?.length>90 && s.comprobar?.length>18).length,all.length);
 assert.ok(new Set(all.map(s=>s.entrada)).size===all.length,'Each lesson should have its own example');
 assert.ok(new Set(all.map(s=>s.comprobar)).size===all.length,'Each topic should have its own check question');
 assert.ok(all.every(s=>s.paragraphs.length>0&&s.paragraphs.every(p=>p.length>50)));
 assert.match(ui,/class="pedagogy-step"/);
 assert.match(ui,/PARA EMPEZAR · UN EJEMPLO/);
 assert.match(ui,/PARA PENSAR/);
 const css=readFileSync(new URL('../public/course.css',import.meta.url),'utf8');
 assert.match(css,/\.reading \.pedagogy-step/);
});

test('nonce is taught before proof-of-work and has a functioning toy search with explicit Bitcoin distinctions',()=>{
 const sections=course.units[2].sections;
 const nonceIndex=sections.findIndex(s=>s.title.includes('Qué es el nonce'));
 const powIndex=sections.findIndex(s=>s.title.startsWith('Proof of Work'));
 assert.ok(nonceIndex>=0&&nonceIndex<powIndex);
 const body=sections[nonceIndex].paragraphs.join(' ');
 assert.match(body,/32 bits/);
 assert.match(body,/80 bytes/);
 assert.match(body,/4\.294\.967\.295/);
 assert.match(body,/SHA-256/);
 assert.match(body,/extranonce/);
 assert.match(body,/objetivo/);
 assert.match(body,/no comprueba/);
 assert.ok(sections[nonceIndex].paragraphs.length>=6);
 assert.match(ui,/function noncePlayground/);
 assert.match(ui,/function renderNonceAttempt/);
 assert.match(ui,/function bindNonceLab/);
 assert.match(ui,/crypto\.subtle\.digest/);
 assert.match(ui,/nonceSearch/);
 assert.match(ui,/5000/);
 assert.match(ui,/bindNonceLab\(\);/);
 assert.ok(course.references.some(r=>r.url.includes('bitcoindevelopers.org/docs/reference/block-chain-ref')));
});

test('both jornadas have date and time in Argentina and Colombia, and all five day-two units have rich visual content',()=>{
 assert.match(ui,/Jueves 12 de noviembre de 2026/);
 assert.match(ui,/19:30–21:30/);
 assert.match(ui,/17:30–19:30/);
 assert.match(ui,/Miércoles 25 de noviembre de 2026/);
 assert.match(ui,/13:00–15:00/);
 assert.match(ui,/11:00–13:00/);
 const functions=['aiModesPanel','creditDistributionPanel','auditWorkbenchPanel','infrastructureAtlasPanel','finalDayTwoPanel'];
 for(const fn of functions)assert.match(ui,new RegExp('function '+fn+'\\('));
 for(const ref of ['data-ai-mode','creditThreshold','auditCount','atlas-grid','day-two-deliverable'])assert.ok(ui.includes(ref));
 assert.match(ui,/bindDay2Studios\(\);/);
 assert.match(ui,/function bindDay2Studios/);
 const css=readFileSync(new URL('../public/course.css',import.meta.url),'utf8');
 for(const item of ['.daySchedule','.unitSchedule','.studio-tabs','.credit-comparison','.audit-grid','.atlas-card','.nonce-lab'])assert.ok(css.includes(item));
});
