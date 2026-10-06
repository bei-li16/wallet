const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const C = require('../js/domain/core.js');
function renderChart(width, kind = 'bar', count = 27, supplied = {}) {
  let mounted, option = {}, zoom;
  const events = {}, zrEvents = {}, watchers = [], emitted = [];
  const window = {}, props = { kind, visible:true,
    rows:Array.from({length:count}, (_,i)=>({label:String(i),value:100,parts:{交通:100}})),
    groups:[{name:'交通',color:'#3879df',value:2700}], ...supplied };
  const context = { window, WalletCore:C, matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}}),
    ResizeObserver:class {observe(){} disconnect(){}},
    echarts:{graphic:{LinearGradient:class {}},init:()=>({
      on(name,fn){events[name]=fn;}, getZr:()=>({on(name,fn){zrEvents[name]=fn;}}),
      setOption(o,reset){
        if(reset===true) option=o;
        else { if(o.graphic) option.graphic=o.graphic; if(o.series) o.series.forEach((s,i)=>Object.assign(option.series[i],s)); }
      }, getOption:()=>({dataZoom:[zoom || option.dataZoom[0]]}), resize(){}, dispose(){},
      containPixel:(_,point)=>point[1]>=24 && point[1]<=200,
      convertFromPixel:(_,x)=>Math.round((x-30)/25),
      convertToPixel:(finder,n)=>finder.xAxisIndex===0 ? 30+n*25 : 200-n*2,
    })},
    Vue:{ref:value=>({value}),onMounted:fn=>mounted=fn,onUnmounted(){},watch:(_,fn)=>watchers.push(fn),nextTick:fn=>fn()}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js/charts.js'),'utf8'),context);
  const ui = window.WalletChart.setup(props,{emit:(...args)=>emitted.push(args)});
  ui.canvas.value={clientWidth:width}; ui.panel.value={offsetWidth:180}; ui.detailRows.value={scrollTop:90}; mounted();
  return {get option(){return option;}, ui, props, events, zrEvents, watchers, emitted,
    zoom(start,end){zoom={start,end};events.datazoom();}};
}

test('long bar and trend timelines keep their slider and visible selection range',()=>{
  const chart=renderChart(300);
  assert.equal(chart.ui.zoomed.value,true); assert.equal(chart.option.dataZoom.length,1);
  assert.equal(chart.option.dataZoom[0].endValue,26); assert.ok(chart.ui.firstVisible.value>0);
  const short=renderChart(300,'bar',5); assert.equal(short.ui.zoomed.value,false); assert.equal(short.option.dataZoom.length,0);
  assert.equal(renderChart(1000).option.dataZoom.length,0);
  assert.equal(renderChart(300,'line').option.dataZoom.length,1);
  chart.ui.choose(26); assert.equal(chart.ui.selected.value,26);
  chart.zoom(0,20); assert.equal(chart.ui.detail.value,null); assert.equal(chart.ui.selected.value,-1);
  chart.ui.choose(1); assert.equal(chart.ui.selected.value,1);
  chart.watchers[1](); assert.equal(chart.ui.selected.value,1); assert.equal(chart.option.dataZoom[0].end,20);
});

test('stack selection has exact totals, every category including zeros, and no drill side effect',()=>{
  const groups=Array.from({length:10},(_,i)=>({name:i===9?'<img src=x onerror=alert(1)>':`分类${i}`,color:i===9?'red" onclick="bad':'#3879df'}));
  const rows=[{label:'2月',start:'2026-02-01',end:'2026-02-28',value:30003,parts:{分类0:10001,分类1:20002}},
    {label:'3月',start:'2026-03-01',end:'2026-03-31',value:0,parts:{}}];
  const chart=renderChart(300,'bar',2,{groups,rows});
  chart.zrEvents.click({offsetX:30,offsetY:100});
  assert.equal(chart.ui.detail.value.title,'2026年2月'); assert.equal(chart.ui.detail.value.total,30003);
  assert.equal(chart.ui.detail.value.items.length,10); assert.equal(chart.ui.detail.value.items[2].value,0);
  assert.equal(chart.ui.detail.value.items[9].name,groups[9].name); assert.equal(chart.ui.detail.value.items[9].color,'#3979df');
  assert.equal(chart.option.tooltip.show,false); assert.equal(chart.option.axisPointer.show,false);
  assert.equal(chart.option.series[0].data[0].itemStyle.opacity,1); assert.equal(chart.option.series[0].data[1].itemStyle.opacity,0.4);
  assert.ok(chart.option.graphic.some(g=>g.type==='rect'&&g.style.stroke==='#3979df'));
  assert.equal(chart.ui.detailRows.value.scrollTop,0); assert.equal(chart.emitted.length,0);
  chart.zrEvents.click({offsetX:55,offsetY:100});
  assert.equal(chart.ui.detail.value.title,'2026年3月'); assert.equal(chart.ui.detail.value.total,0);
  assert.equal(chart.option.series[0].data[0].itemStyle.opacity,0.4); assert.equal(chart.option.series[0].data[1].itemStyle.opacity,1);
  chart.zrEvents.click({offsetX:30,offsetY:230}); assert.equal(chart.ui.selected.value,1);
});

test('changing category, period or user clears stale details, while hidden/visible preserves selection',()=>{
  const chart=renderChart(300,'bar',5); chart.ui.choose(2);
  chart.props.visible=false; chart.watchers[1](); chart.props.visible=true; chart.watchers[1]();
  assert.equal(chart.ui.selected.value,2);
  chart.props.rows=[{label:'其他用户',value:234,parts:{交通:234}}]; chart.watchers[0]();
  assert.equal(chart.ui.detail.value,null); assert.equal(chart.ui.selected.value,-1);
  assert.equal(chart.option.graphic.length,0); assert.equal(chart.option.series[0].data[0].itemStyle.opacity,1);
});

test('detail anchor stays aligned and the compact panel stays inside both chart edges',()=>{
  const chart=renderChart(300,'bar',10); chart.ui.choose(9);
  assert.equal(chart.ui.panelStyle.value.marginLeft,'120px'); assert.equal(chart.ui.dockStyle.value['--chart-anchor'],'255px');
  chart.zoom(0,100); chart.ui.choose(0);
  assert.equal(chart.ui.panelStyle.value.marginLeft,'0px'); assert.equal(chart.ui.panelStyle.value['--detail-anchor'],'30px');
});

test('trend selects the nearest period and distinguishes week/month/year titles',()=>{
  const rows=[{label:'6/1',start:'2026-06-01',end:'2026-06-07',value:12345},
    {label:'26/06',start:'2026-06-01',end:'2026-06-30',value:45678},
    {label:'2026',start:'2026-01-01',end:'2026-12-31',value:78900}];
  const chart=renderChart(300,'line',3,{rows}); chart.ui.choose(0);
  assert.equal(chart.ui.detail.value.title,'2026/06/01–06/07'); assert.equal(chart.ui.detail.value.total,12345);
  assert.equal(chart.ui.detail.value.items.length,0, 'trend without category buckets keeps its compact total-only detail');
  assert.ok(chart.option.graphic.some(g=>g.type==='circle'&&g.shape.r===6));
  chart.ui.choose(1); assert.equal(chart.ui.detail.value.title,'2026年6月');
  chart.ui.choose(2); assert.equal(chart.ui.detail.value.title,'2026年');
});

test('report curves show main/subcategory amounts under the selected period, including zero periods',()=>{
  const records=[
    C.normalizeRecord({id:'ai',date:'2026-01-02',amountCents:19901,category:'AI',subcategory:'订阅'}),
    C.normalizeRecord({id:'parking',date:'2026-01-03',amountCents:725,category:'交通',subcategory:'停车'}),
    C.normalizeRecord({id:'api',date:'2026-03-01',amountCents:308,category:'AI',subcategory:'API 用量'}),
  ];
  const chart=renderChart(300,'line',3,{rows:C.buckets(records,'all',''),groups:C.breakdown(records)});
  assert.deepEqual(Array.from(chart.option.series[0].data),[206.26,0,3.08]);
  chart.ui.choose(0);
  assert.equal(chart.ui.detail.value.total,20626);
  assert.deepEqual(Array.from(chart.ui.detail.value.items,i=>[i.name,i.value]),[['AI',19901],['交通',725]]);
  chart.ui.choose(1); assert.equal(chart.ui.detail.value.title,'2026年2月');
  assert.equal(chart.ui.detail.value.total,0); assert.ok(chart.ui.detail.value.items.every(i=>i.value===0));
  chart.props.rows=C.buckets(records.filter(r=>r.category==='AI'),'all','','month','AI');
  chart.props.groups=C.breakdown(records,'AI'); chart.watchers[0]();
  assert.equal(chart.ui.detail.value,null); chart.ui.choose(2);
  assert.equal(chart.ui.detail.value.total,308);
  assert.deepEqual(Array.from(chart.ui.detail.value.items,i=>[i.name,i.value]),[['订阅',0],['API 用量',308]]);
  assert.equal(chart.option.tooltip.show,false); assert.equal(chart.emitted.length,0);
});

test('a single month/year curve and a zoomed single period retain a visible data point',()=>{
  const record=C.normalizeRecord({id:'one',date:'2026-10-02',amountCents:19900,category:'AI',subcategory:'订阅'});
  for(const granularity of ['month','year']){
    const chart=renderChart(300,'line',1,{rows:C.buckets([record],'all','',granularity),groups:C.breakdown([record])});
    assert.equal(chart.option.series[0].showSymbol,true); assert.equal(chart.option.dataZoom.length,0);
    chart.ui.choose(0); assert.equal(chart.ui.detail.value.total,19900);
  }
  const chart=renderChart(300,'line',27); assert.equal(chart.option.series[0].showSymbol,false);
  chart.zoom(50,50); assert.equal(chart.option.series[0].showSymbol,true);
  chart.ui.choose(13); assert.equal(chart.ui.detail.value.total,100);
  chart.zoom(0,100); assert.equal(chart.option.series[0].showSymbol,false);
});

test('pie charts retain category drill and escaped compact single-item tooltips',()=>{
  const chart=renderChart(300,'pie'); chart.events.click({name:'交通'});
  assert.deepEqual(chart.emitted,[['select','交通']]);
  const html=chart.option.tooltip.formatter({name:'<script>',value:1,percent:100});
  assert.ok(!html.includes('<script>')); assert.match(html,/&lt;script&gt;/); assert.match(html,/¥1\.00/);
  chart.zrEvents.click({offsetX:30,offsetY:100}); assert.equal(chart.ui.detail.value,null);
});

test('vendored ECharts renders selection and preserves zoom using its real SVG renderer',()=>{
  const watchers=[];
  const context={window:{},WalletCore:C,console,setTimeout,clearTimeout,
    matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}}),
    ResizeObserver:class {observe(){} disconnect(){}},
    Vue:{ref:value=>({value}),onMounted:fn=>mounted=fn,onUnmounted(){},watch:(_,fn)=>watchers.push(fn),nextTick:fn=>fn()}};
  let mounted, chart, viewportWidth=300;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/vendor/echarts.min.js'),'utf8'),context);
  const realInit=context.echarts.init;
  context.echarts.init=()=>{
    chart=realInit(null,null,{renderer:'svg',ssr:true,width:300,height:250});
    const resize=chart.resize;
    chart.resize=(options={})=>resize.call(chart,{width:viewportWidth,height:250,...options});
    return chart;
  };
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/charts.js'),'utf8'),context);
  const rows=C.buckets([
    C.normalizeRecord({id:'first',date:'2024-06-01',amountCents:12345,category:'交通',subcategory:'停车'}),
    C.normalizeRecord({id:'last',date:'2026-09-01',amountCents:54321,category:'交通',subcategory:'加油'}),
  ],'all','');
  const props={kind:'bar',visible:true,rows,groups:[{name:'交通',color:'#3979df',value:66666}]};
  const ui=context.window.WalletChart.setup(props,{emit(){}});
  ui.canvas.value={clientWidth:300,clientHeight:250}; ui.panel.value={offsetWidth:180}; mounted();
  try {
    ui.choose(27); assert.equal(ui.detail.value.total,54321);
    const svg=chart.renderToSVGString(); assert.match(svg,/2026-09/); assert.match(svg,/#3979df/);
    const selectedShape=chart.getOption().graphic[0].elements.find(g=>g.type==='rect');
    const pixel=chart.convertToPixel({xAxisIndex:0},27);
    assert.ok(Math.abs(selectedShape.shape.x+selectedShape.shape.width/2-pixel)<0.01);
    assert.ok(selectedShape.shape.height>10); assert.ok(Number.isFinite(parseFloat(ui.panelStyle.value.marginLeft)));
    chart.dispatchAction({type:'dataZoom',start:0,end:20});
    assert.equal(ui.detail.value,null);
    chart.getZr().trigger('click',{offsetX:chart.convertToPixel({xAxisIndex:0},0),offsetY:100});
    assert.equal(ui.detail.value.total,12345); assert.equal(ui.detail.value.title,'2024年6月');
    ui.choose(1); assert.equal(ui.detail.value.total,0); assert.ok(chart.renderToSVGString().includes('2024-07'));
    const range=chart.getOption().dataZoom[0]; assert.equal(range.start,0); assert.equal(range.end,20);
    viewportWidth=375; ui.canvas.value.clientWidth=375; watchers[1]();
    assert.equal(chart.getWidth(),375); assert.equal(ui.selected.value,1);
    assert.equal(chart.getOption().dataZoom[0].end,20);
    props.kind='line'; watchers[0](); ui.choose(27);
    assert.equal(chart.getOption().series[0].type,'line');
    assert.equal(ui.detail.value.total,54321); assert.equal(ui.detail.value.items.length,1);
    assert.equal(ui.detail.value.items[0].name,'交通'); assert.equal(ui.detail.value.items[0].value,54321);
    assert.ok(chart.getOption().graphic[0].elements.some(g=>g.type==='circle'&&g.shape.r===6));
    const lineSvg=chart.renderToSVGString(); assert.ok(!lineSvg.includes('NaN')); assert.ok(!lineSvg.includes('undefined'));
    chart.dispatchAction({type:'dataZoom',startValue:27,endValue:27});
    assert.equal(chart.getOption().series[0].showSymbol,true);
    props.rows=rows.slice(-1); watchers[0]();
    assert.equal(chart.getOption().series[0].showSymbol,true); assert.equal(chart.getOption().series[0].data.length,1);
    assert.ok(!chart.renderToSVGString().includes('NaN')); ui.choose(0);
    const point=chart.getOption().graphic[0].elements.find(g=>g.type==='circle'&&g.shape.r===6);
    assert.ok(Math.abs(point.shape.cx-chart.convertToPixel({xAxisIndex:0},0))<0.01);
    assert.equal(ui.detail.value.total,54321);
    props.kind='pie'; watchers[0]();
    assert.equal(chart.getOption().series[0].type,'pie'); assert.equal(ui.detail.value,null);
    assert.equal(ui.zoomed.value,false); assert.equal((chart.getOption().graphic || []).length,0);
  } finally { chart.dispose(); }
});
