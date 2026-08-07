import{C as d}from"./characters-CjHEsddi.js";function m(o){const i=document.getElementById("ui-root"),n=document.createElement("div");n.className="sc-panel",n.innerHTML=`
    <div class="sc-title">Character Showcase</div>
    <div class="sc-row" id="sc-chars"></div>
    <div class="sc-row" id="sc-anims"></div>
    <div class="sc-row" id="sc-toggles">
      <button data-t="night">夜にする</button>
      <button data-t="lineup">みんな ならべる</button>
      <button data-t="turntable" class="on">回転</button>
    </div>
    <div class="sc-stats" id="sc-stats"></div>
  `,i.appendChild(n);const a=n.querySelector("#sc-chars");for(const t of o.characterIds){const s=d[t],e=document.createElement("button");e.textContent=`${s.name}(${s.species})`,e.dataset.id=t,t===o.currentCharacter&&e.classList.add("on"),e.onclick=()=>{o.setCharacter(t),a.querySelectorAll("button").forEach(c=>c.classList.toggle("on",c===e)),n.querySelector('[data-t="lineup"]').classList.remove("on")},a.appendChild(e)}const l=n.querySelector("#sc-anims");for(const t of o.anims){const s=document.createElement("button");s.textContent=t,s.onclick=()=>{o.setAnim(t),l.querySelectorAll("button").forEach(e=>e.classList.toggle("on",e===s))},t==="idle"&&s.classList.add("on"),l.appendChild(s)}n.querySelector("#sc-toggles").querySelectorAll("button").forEach(t=>{const s=t;s.onclick=()=>{const e=!s.classList.contains("on");s.classList.toggle("on",e);const c=s.dataset.t;c==="night"?(o.setNight(e),s.textContent=e?"昼にする":"夜にする"):c==="lineup"?o.setLineup(e):c==="turntable"&&o.setTurntable(e)}});const r=n.querySelector("#sc-stats");setInterval(()=>{const t=o.stats();r.textContent=`FPS ${t.fps} | 三角形 ${t.tris.toLocaleString()} | マテリアル ${t.materials} | テクスチャ ${t.texKB}KB | GLB ${t.glbKB}KB`},500)}export{m as buildShowcaseUI};
