const g={healthy:'<circle class="body" cx="6" cy="6" r="6"/>',unhealthy:'<circle class="body" cx="6" cy="6" r="6"/><rect class="mark" x="5" y="3" width="2" height="6" rx="1"/>',starting:'<circle class="ring" cx="6" cy="6" r="5.25" stroke-width="1.5"/><path class="half" d="M6 0.75A5.25 5.25 0 0 0 6 11.25Z"/>',"not-running":'<circle class="ring" cx="6" cy="6" r="5" stroke-width="2"/>',checking:'<path class="arc" d="M9.536 2.464A5 5 0 1 1 2.464 2.464" stroke-width="2"/>',failed:'<circle class="body" cx="6" cy="6" r="6"/><rect class="mark" x="5" y="2" width="2" height="5" rx="1"/><rect class="mark" x="5" y="8" width="2" height="2" rx="1"/>',unknown:'<circle class="dashed" cx="6" cy="6" r="5.25" stroke-width="1.5" stroke-dasharray="3.2 2.3"/>'},y=t=>`<svg class="dot" viewBox="0 0 12 12" aria-hidden="true" focusable="false">${g[t]??""}</svg>`,A=["healthy","unhealthy","starting","not-running","checking","unknown","failed"],a={healthy:"healthy",unhealthy:"unhealthy",starting:"starting","not-running":"not running",checking:"checking",unknown:"not checked",failed:"check failed"},l="No privilege to check the interpreter health",c={healthy:"Healthy",unhealthy:"Unhealthy | No answer",starting:"Starting","not-running":"Not running | starts on use",checking:"Checking",unknown:"Not checked",failed:`Check failed | ${l} (last: Healthy)`},u="Checked at 10:04:48 AM",o={unhealthy:"Process exists but does not answer","not-running":`No interpreter process is running.
It starts on first use.`,starting:"The interpreter process is starting.",unknown:"Not checked yet.",failed:`${l}
Last result: Healthy, checked at 10:04:48 AM`};let k=0;const v=(t,n,e)=>{if(n==="checking")return"";const s=[`<strong>${t}: ${a[n][0].toUpperCase()}${a[n].slice(1)}</strong>`];return o[n]&&s.push(...o[n].split(`
`)),n!=="unknown"&&n!=="failed"&&s.push(u),s.push("Click to check again"),`<span class="tip" id="${e}" role="tooltip">${s.join("<br>")}<span class="tip-arrow"></span></span>`},$=t=>t.replace(/&/g,"&amp;").replace(/</g,"&lt;"),f=["healthy","checking"],N=(t,n)=>{const e=`zx-tip-${++k}`,s=v(t,n,e);return`<button type="button" class="zx-ih" data-state="${n}"${s?` aria-describedby="${e}"`:""} aria-label="${t} interpreter: ${c[n]}. Activate to check again">${f.includes(n)?"":`<span class="zx-text">${c[n]}</span>`}${y(n)}${s}</button>`},r='<svg class="zp-handle" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M20 10 10 20M20 15l-5 5"/></svg>',b="<table><thead><tr>"+Array.from({length:8},(t,n)=>`<th>col_${n}</th>`).join("")+"</tr></thead><tbody>"+Array.from({length:4},(t,n)=>"<tr>"+Array.from({length:8},(e,s)=>`<td>r${n}-c${s} value</td>`).join("")+"</tr>").join("")+"</tbody></table>",i={text:`<div class="zp-result"><pre>hello from the interpreter
second line of output</pre>${r}</div>`,table:`<div class="zp-result table">${b}${r}</div>`,error:`<div class="zp-result error"><pre>Traceback (most recent call last):
  File "&lt;stdin&gt;", line 1, in &lt;module&gt;
NameError: name 'x' is not defined</pre>${r}</div>`,none:""},x='<span class="zp-ico" aria-hidden="true"></span>'.repeat(4),m=["READY","PENDING","RUNNING","FINISHED","ERROR","ABORT"],R=["python","sh","md","spark","flink","java","groovy","jdbc"],E={python:`%python
print("hello")`,sh:`%sh
echo hello`,md:`%md
# Title`,spark:`%spark
spark.range(10).show()`,flink:`%flink
val x = 1`,java:`%java
System.out.println(1);`,groovy:`%groovy
println 1`,jdbc:`%jdbc
select 1`};function T({interpreter:t="python",health:n="healthy",status:e="FINISHED",output:s="text",widthCols:h=12}={}){const d=!["READY","PENDING"].includes(e)&&s!=="none"?'<div class="footer">Took 0 seconds. Last updated by anonymous at October 17 2026, 9:30:12 AM.</div>':'<div class="footer"></div>',p=e==="ERROR"?i.error:e==="READY"||e==="PENDING"||e==="RUNNING"?"":i[s];return`<div style="width:${h/12*100}%;min-width:0">
  <div class="zp">
    <div class="zp-ctl"><span class="zp-status">${e}</span>${x}</div>
    <div class="zp-code">${$(E[t])}</div>
    ${p}
    <div class="zp-ft">${d}${N(t,n)}</div>
  </div>
</div>`}export{u as C,A as H,R as I,a as L,m as S,T as a,N as c,y as d};
