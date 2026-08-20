import{bk as w,aP as u,bl as p,s as m,bm as b,aQ as $,aR as h,bn as y,bo as x,bp as v,bq as g,br as k,bs as M}from"./index-f2acnGIR.js";import{b as S,H as L,a as B}from"./helpText-Q6u2mfU6.js";const E={badJson:"ファイルの 中みが こわれているみたい。",notBundle:"これは ルミ島の セーブファイルでは ないみたい。",futureFormat:"これは もっと あたらしい ルミ島の ファイルみたい。",checksum:"ほぞんしたあとに 中みが かわっているみたい。",badSave:"中の セーブデータが よみとれなかった。"};function d(r){return`<div class="tm-sum"><span>${r.day}にちめ</span><span>ルミナ ${r.lumina}</span><span>バッジ ${r.badges}こ</span></div>`}function f(r){if(!r)return"";const t=new Date(r),n=a=>String(a).padStart(2,"0");return`${t.getMonth()+1}/${t.getDate()} ${n(t.getHours())}:${n(t.getMinutes())}`}class T{el;onStart=null;constructor(){this.el=document.createElement("div"),this.el.className="title-screen",document.getElementById("ui-root").appendChild(this.el),this.render()}render(){const t=w(),n=u(),a=p().filter(e=>e.summary!==null),c=this.el.querySelector(".title-extra:not(.hidden)")?.dataset.panel??"",s=e=>c===e?"":"hidden";this.el.innerHTML=`
      <div class="title-inner">
        <div class="title-logo">
          <div class="title-jp">ルミ島のくらし</div>
          <div class="title-en">Lumi Island</div>
          <div class="title-sub">夜になると、島がひかる。</div>
        </div>
        <div class="title-menu">
          <button class="title-btn" data-act="new">はじめから</button>
          <button class="title-btn" data-act="continue" ${t?"":"disabled"}>つづきから</button>
          <button class="title-btn sub" data-act="settings">せってい</button>
          <button class="title-btn sub" data-act="help">そうさほうほう</button>
        </div>
        <div class="title-extra ${s("settings")}" data-panel="settings">
          <div class="tx-row"><span>おと</span><button class="title-btn sub" data-act="sound">${n.sound?"オン":"オフ"}</button></div>
          <div class="tx-row"><span>セーブデータ</span><button class="title-btn danger" data-act="wipe" ${t?"":"disabled"}>けす</button></div>
          <div class="tx-head">データの まもり</div>
          <div class="tx-col">
            <button class="title-btn sub tx-wide" data-act="export" ${t?"":"disabled"}>セーブを ファイルに ほぞん</button>
            <button class="title-btn sub tx-wide" data-act="import">ファイルから よみこむ</button>
            <button class="title-btn sub tx-wide" data-act="backups" ${a.length?"":"disabled"}>まえの データに もどす</button>
          </div>
          <div class="tx-note">ファイルに 保存しておくと、消えても もどせます(おうちの人と いっしょに)。</div>
          <input class="tx-file" type="file" accept="application/json,.json">
        </div>
        <div class="title-extra ${s("help")}" data-panel="help">
          <div class="help-grid">${S(B,L)}
          </div>
        </div>
        <div class="title-credit">オリジナル作品 / 3Dモデル・音はすべてプログラム生成 <span class="title-ver">v15.1</span></div>
      </div>
    `;const i=this.el.querySelector(".tx-file");i.onchange=()=>{const e=i.files?.[0];i.value="",e&&this.importFile(e)},this.el.querySelectorAll("[data-act]").forEach(e=>{e.onclick=async()=>{m("ui");const l=e.dataset.act;if(l==="new"){if(t&&!await this.confirmModal("セーブデータがあります。<br>はじめからにすると消えますが、いいですか?"))return;b(),this.onStart?.("new")}else if(l==="continue")this.onStart?.("continue");else if(l==="settings"||l==="help")this.el.querySelectorAll(".title-extra").forEach(o=>{o.classList.toggle("hidden",o.dataset.panel!==l||!o.classList.contains("hidden"))}),this.el.querySelector(".title-extra:not(.hidden)")?.scrollIntoView({block:"end"});else if(l==="sound"){const o=u();o.sound=!o.sound,$(o),h(o.sound),e.textContent=o.sound?"オン":"オフ"}else l==="wipe"?await this.confirmModal("セーブデータを完全に消します。いいですか?")&&(b(),this.render()):l==="export"?this.exportFile():l==="import"?i.click():l==="backups"&&await this.backupsFlow()}})}exportFile(){const t=y();if(!t){this.infoModal("ほぞんできる セーブデータが ないよ。");return}const n=x();try{const s=URL.createObjectURL(new Blob([t],{type:"application/json"})),i=document.createElement("a");i.href=s,i.download=n,i.rel="noopener",document.body.appendChild(i),i.click(),i.remove(),window.setTimeout(()=>URL.revokeObjectURL(s),1e4)}catch(s){console.warn("[title] 書き出しに失敗",s),this.infoModal('ファイルに ほぞんできなかった…<br><span class="tm-note">ブラウザの 設定を みてね。</span>');return}const a=v(t);a.ok||console.warn("[title] 書き出した包みが読み直せない:",a.reason);const c=a.ok?d(a.summary):"";this.infoModal(`ファイルに 保存したよ。<br><span class="tm-file">${n}</span>${c}<span class="tm-note">「ダウンロード」や ファイルアプリの 中に あるよ。</span>`)}async importFile(t){let n="";try{n=await t.text()}catch(s){console.warn("[title] ファイルを読めない",s)}const a=v(n);if(!a.ok){await this.infoModal(`この ファイルは よめなかった…<br><span class="tm-note">${E[a.reason]}</span>`);return}if(await this.confirmModal(`この データを よみこみます。${d(a.summary)}いまの データに うわがきします。いい?<br><span class="tm-note">いまの データは「まえの データに もどす」で 1回だけ もどせます。</span>`)){if(!g(a)){await this.infoModal('よみこめなかった…<br><span class="tm-note">ブラウザの あきようりょうが たりないかも。</span>');return}h(u().sound),this.render(),await this.infoModal(`よみこんだよ。${d(a.summary)}「つづきから」で あそべるよ。`)}}async backupsFlow(){const t=p().filter(e=>e.summary!==null);if(t.length===0){await this.infoModal('まだ まえの データは ないよ。<br><span class="tm-note">日が かわって さいしょに ほぞんしたとき、まえの日の データが ここに たまります。</span>');return}const n=Math.max(1,Math.round(k()/1024)),a=t.map(e=>({label:`<b>${f(e.at)}</b><span>${e.summary.day}にちめ ・ ルミナ ${e.summary.lumina} ・ バッジ ${e.summary.badges}こ</span>`,value:e.slot})),c=await this.chooseModal(`どの データに もどしますか?<br><span class="tm-note">あたらしい順。ぜんぶで ${n}KB。</span>`,a);if(c===null)return;const s=t.find(e=>e.slot===c);if(await this.confirmModal(`${f(s.at)} の データに もどします。${d(s.summary)}いまの データに うわがきします。いい?<br><span class="tm-note">いまの データは「まえの データに もどす」で 1回だけ もどせます。</span>`)){if(!M(c)){await this.infoModal('もどせなかった…<br><span class="tm-note">その データは よみとれませんでした。</span>');return}this.render(),await this.infoModal(`もどしたよ。${d(s.summary)}「つづきから」で あそべるよ。`)}}modal(t,n,a={}){return new Promise(c=>{const s=document.createElement("div");s.className="title-confirm";const i=n.map((l,o)=>`<button class="title-btn ${l.cls??""}" data-a="${o}">${l.label}</button>`).join(""),e=a.cancel===void 0?"":'<button class="title-btn sub" data-a="cancel">やめる</button>';s.innerHTML=`
        <div class="tc-box">
          <div class="tc-msg">${t}</div>
          <div class="tc-btns${a.vertical?" tm-col":""}">${i}${e}</div>
        </div>`,s.querySelectorAll("button").forEach(l=>{l.onclick=()=>{m("ui"),s.remove();const o=l.dataset.a;c(o==="cancel"?a.cancel:n[Number(o)].value)}}),this.el.appendChild(s)})}confirmModal(t){return this.modal(t,[{label:"はい",value:!0,cls:"danger"},{label:"やめる",value:!1}])}infoModal(t){return this.modal(t,[{label:"わかった",value:!0}])}chooseModal(t,n){return this.modal(t,n.map(a=>({label:a.label,value:a.value,cls:"sub tm-pick"})),{vertical:!0,cancel:null})}setLoading(){const t=this.el.querySelector(".title-menu");t&&(t.innerHTML='<div class="title-loading">島をじゅんびしています…</div>')}dispose(){this.el.remove()}}export{T as TitleScreen};
