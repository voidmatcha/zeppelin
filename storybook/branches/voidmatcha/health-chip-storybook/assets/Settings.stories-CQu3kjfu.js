const s={healthy:"Healthy",unhealthy:"Unhealthy",starting:"Starting","not-running":"Not running",checking:"Checking"},o={healthy:["spark","shared: process running"],unhealthy:["python","shared: process not responding"],starting:["spark","shared: process is starting"],"not-running":["md","No interpreter process is running.","It starts on first use."],checking:null},i=n=>{const t=o[n],e=t?`<span class="tip" role="tooltip"><strong>${t[0]}</strong><br>${t[1]}${t[2]?`<br>${t[2]}`:""}<br>Checked at 9:30:12 AM</span>`:"";return`<span class="badge" data-state="${n}" tabindex="0"><span class="bd"></span>${s[n]}${e}</span>`},r=n=>`<div class="sp">
  <h2>Settings</h2>
  <h3>Interpreter binding</h3>
  <p>Bind interpreter for this note. Click to Bind/Unbind interpreter. Drag and drop to reorder interpreters.</p>
  <div class="sp-list">${n.map(([t,e,p],a)=>`
    <div class="sp-box">
      <span class="sp-refresh" aria-hidden="true">&#8635;</span>
      <div class="sp-health"><button type="button" class="sp-btn" aria-label="Check health of ${t}">&#9825; Check health</button>${i(p)}</div>
      <button type="button" class="sp-btn ${a===0?"primary":"default"}">${t}<small>% ${e.replace(/, /g,", %")}${a===0?" (default)":""}</small></button>
    </div>`).join("")}
  </div>
  <div class="sp-actions"><button type="button" class="sp-btn primary">Save</button><button type="button" class="sp-btn default">Cancel</button></div>
</div>`,l={title:"Health chip/Settings panel (interpreter binding)",parameters:{docs:{description:{component:'Static replica of the note Settings > Interpreter binding panel (ZEPPELIN-6578): a "Check health" button and a text badge per interpreter setting. Hover a badge for the details tooltip.'}}},argTypes:{health:{control:"select",options:Object.keys(s)}}},h={args:{health:"healthy"},render:({health:n})=>r([["spark","spark, pyspark, sql",n],["python","python","unhealthy"],["md","md","not-running"]])},d={render:()=>r(Object.keys(s).map((n,t)=>[["spark","python","jdbc","sh","md"][t],["spark, pyspark, sql","python","jdbc","sh","md"][t],n]))},c=["Default","AllStates"];export{d as AllStates,h as Default,c as __namedExportsOrder,l as default};
