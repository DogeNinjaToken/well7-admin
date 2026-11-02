/* Small, dependency-free SVG visual primitives. All values are rendered in their source units. */
(()=>{'use strict';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clamp=n=>Math.max(0,Math.min(100,Number(n)||0));
function gauge({label,value,percent=0,caption='',tone='cyan',note=''}){
 const pct=clamp(percent),offset=(339.292*(1-pct/100)).toFixed(2),ticks=Array.from({length:48},(_,i)=>`<line x1="66" y1="3" x2="66" y2="${i%4===0?9:6}" transform="rotate(${i*7.5} 66 66)"/>`).join('');
 return `<article class="viz-gauge ${tone}"><div class="viz-gauge-head"><span>${esc(label)}</span><i aria-hidden="true"></i></div><div class="viz-gauge-face"><svg viewBox="0 0 132 132" role="img" aria-label="${esc(label)} ${pct.toFixed(1)} percent"><circle class="gauge-halo" cx="66" cy="66" r="61"/><g class="gauge-ticks">${ticks}</g><circle class="gauge-track" cx="66" cy="66" r="54"/><circle class="gauge-arc" cx="66" cy="66" r="54" stroke-dasharray="339.292" stroke-dashoffset="${offset}"/><circle class="gauge-core-ring" cx="66" cy="66" r="43"/><circle class="gauge-orbit-dot" cx="66" cy="12" r="2"/></svg><div class="viz-gauge-center"><b>${pct.toFixed(0)}<small>%</small></b><span>${esc(caption)}</span></div></div><div class="viz-gauge-value">${esc(value)}</div>${note?`<small class="viz-gauge-note">${esc(note)}</small>`:''}</article>`;
}
function bars({title,subtitle='',items=[],max=null,unit='',note='',tone='cyan'}){
 const scale=max==null?Math.max(1,...items.map(x=>Number(x.value)||0)):Math.max(1,Number(max));
 return `<section class="viz-chart ${tone}"><header class="viz-chart-head"><div><span>${esc(title)}</span>${subtitle?`<small>${esc(subtitle)}</small>`:''}</div><b>LIVE DATA</b></header><div class="viz-bars">${items.map(x=>{const v=Number(x.value)||0,p=clamp(v/scale*100);return `<div class="viz-bar-row"><div><span>${esc(x.label)}</span><b>${esc(x.detail??`${v}${unit}`)}</b></div><div class="viz-bar-track"><i style="--bar:${p}%"></i></div></div>`}).join('')||'<p class="viz-empty">Waiting for on-chain reads…</p>'}</div>${note?`<p class="viz-note">${esc(note)}</p>`:''}</section>`;
}
function donut({label='Composition',items=[],total=null}){
 const colors=['#63f3e5','#ad70ff','#578cff','#ffb453','#ed6de9'];let sum=total==null?items.reduce((a,x)=>a+(Number(x.value)||0),0):Number(total);sum=Math.max(0,sum);let offset=0;
 const segments=items.map((x,i)=>{const v=Math.max(0,Number(x.value)||0),len=sum?v/sum*339.292:0,seg=`<circle class="viz-donut-seg" cx="66" cy="66" r="54" stroke="${colors[i%colors.length]}" stroke-dasharray="${len.toFixed(2)} ${Math.max(0,339.292-len).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}"/>`;offset+=len;return seg}).join('');
 return `<div class="viz-donut-wrap"><svg viewBox="0 0 132 132" role="img" aria-label="${esc(label)}"><circle class="viz-donut-track" cx="66" cy="66" r="54"/>${segments}<circle class="viz-donut-core" cx="66" cy="66" r="42"/></svg><div class="viz-donut-label"><b>${esc(label)}</b><small>${items.map((x,i)=>`<i style="--dot:${colors[i%colors.length]}"></i>${esc(x.label)} ${sum?(Number(x.value||0)/sum*100).toFixed(0):'0'}%`).join('<br>')}</small></div></div>`;
}
function topology({title,items=[],caption='Each node links to a live pool card.'}){
 return `<section class="viz-chart viz-topology"><header class="viz-chart-head"><div><span>${esc(title)}</span><small>${esc(caption)}</small></div><b>${items.length} NODES</b></header><div class="viz-nodes" role="list">${items.map(x=>`<button type="button" role="listitem" class="viz-node ${x.active?'active':''} ${x.mine?'mine':''}" data-viz-target="${esc(x.target||'')}" title="${esc(x.title||x.label)}" aria-label="${esc(x.title||x.label)}"><i></i><span>${esc(x.label)}</span></button>`).join('')}</div><div class="viz-legend"><i class="active"></i> Has deposits <i class="mine"></i> Your position <i></i> Awaiting first stake</div></section>`;
}
function emblem({label='DEEPWELL',sub='BSC TESTNET'}={}){return `<div class="orbital-emblem" aria-label="${esc(label)} ${esc(sub)}"><i class="emblem-orbit a"></i><i class="emblem-orbit b"></i><i class="emblem-orbit c"></i><div><img src="/images/deepwell/deepwell-symbol.png" alt=""><span>${esc(label)}</span><small>${esc(sub)}</small></div></div>`}
window.DWUI={gauge,bars,donut,topology,emblem,esc};
})();
