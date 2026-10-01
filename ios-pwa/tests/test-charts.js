const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const C = require('../js/domain/core.js');
function renderChart(width, kind = 'bar', count = 27) {
  let mounted, option;
  const window = {}, props = { kind, visible:true, rows:Array.from({length:count}, (_,i)=>({label:String(i),value:100,parts:{交通:100}})), groups:[{name:'交通',color:'#3879df',value:2700}] };
  const context = { window, WalletCore:C, matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}}),
    ResizeObserver:class {observe(){} disconnect(){}},
    echarts:{init:()=>({on(){},setOption(o){option=o;},resize(){},dispose(){}})},
    Vue:{ref:value=>({value}),onMounted:fn=>mounted=fn,onUnmounted(){},watch(){},nextTick:fn=>fn()}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js/charts.js'),'utf8'),context);
  const ui = window.WalletChart.setup(props,{emit(){}}); ui.canvas.value={clientWidth:width}; mounted();
  return {option,ui};
}
test('mobile long timelines get a usable slider while short timelines stay fully visible',()=>{
  const {option,ui}=renderChart(300);
  assert.equal(ui.zoomed.value,true); assert.equal(option.dataZoom.length,1);
  assert.equal(option.dataZoom[0].endValue,26); assert.ok(option.dataZoom[0].startValue>0);
  const short=renderChart(300,'bar',5); assert.equal(short.ui.zoomed.value,false); assert.equal(short.option.dataZoom.length,0);
  assert.equal(renderChart(1000).option.dataZoom.length,0);
});
test('scrollable HTML details retain every category and escape user-supplied names',()=>{
  const {option}=renderChart(300);
  assert.equal(option.tooltip.renderMode,'html'); assert.equal(option.tooltip.enterable,true); assert.equal(option.tooltip.confine,true);
  const details=option.tooltip.formatter(Array.from({length:10},(_,i)=>({axisValueLabel:'2024-07',seriesName:i===9?'<img src=x onerror=alert(1)>':`分类${i}`,value:i,color:i===9?'red" onclick="bad':'#3879df'})));
  assert.equal((details.match(/class="chart-tooltip-row"/g)||[]).length,10);
  assert.match(details,/上下滑动/); assert.match(details,/&lt;img/); assert.ok(!details.includes('<img')); assert.ok(!details.includes('onclick='));
  assert.match(details,/¥9\.00/);
  const pie=renderChart(300,'pie').option.tooltip.formatter({name:'<script>',value:1,percent:100});
  assert.ok(!pie.includes('<script>')); assert.match(pie,/&lt;script&gt;/);
});
