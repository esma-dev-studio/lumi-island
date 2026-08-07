import{J as p,o as i,s as d,K as l,p as o,q as c}from"./index-Ndx-k36r.js";import{b}from"./inputMode-DFSTZpiE.js";const r=`
            <span><kbd>W A S D</kbd>/<kbd>矢印</kbd></span><span>あるく</span>
            <span><kbd>Shift</kbd></span><span>はしる</span>
            <span><kbd>E</kbd>/<kbd>Space</kbd></span><span>しらべる・とる・はなす</span>
            <span><kbd>Tab</kbd>/<kbd>I</kbd></span><span>もちもの</span>
            <span><kbd>C</kbd></span><span>クラフト</span>
            <span><kbd>Q</kbd></span><span>おねがい</span>
            <span><kbd>Z</kbd></span><span>ずかん</span>
            <span><kbd>R</kbd></span><span>(はいち中)まわす</span>
            <span><kbd>Esc</kbd></span><span>とじる・メニュー</span>`,u=`
            <span>左下を ゆびで うごかす</span><span>あるく</span>
            <span>おおきく うごかす</span><span>はしる</span>
            <span>右下の 大きいボタン</span><span>しらべる・とる・はなす</span>
            <span>右上の「もちもの」</span><span>もちもの</span>
            <span>右上の「クラフト」</span><span>クラフト</span>
            <span>右上の「おねがい」</span><span>おねがい</span>
            <span>右上の「ずかん」</span><span>ずかん</span>
            <span>「まわす」ボタン</span><span>(はいち中)まわす</span>
            <span>右上の「メニュー」</span><span>とじる・メニュー</span>`;class m{el;onStart=null;constructor(){this.el=document.createElement("div"),this.el.className="title-screen",document.getElementById("ui-root").appendChild(this.el),this.render()}render(){const n=p(),e=i();this.el.innerHTML=`
      <div class="title-inner">
        <div class="title-logo">
          <div class="title-jp">ルミ島のくらし</div>
          <div class="title-en">Lumi Island</div>
          <div class="title-sub">夜になると、島がひかる。</div>
        </div>
        <div class="title-menu">
          <button class="title-btn" data-act="new">はじめから</button>
          <button class="title-btn" data-act="continue" ${n?"":"disabled"}>つづきから</button>
          <button class="title-btn sub" data-act="settings">せってい</button>
          <button class="title-btn sub" data-act="help">そうさほうほう</button>
        </div>
        <div class="title-extra hidden" data-panel="settings">
          <div class="tx-row"><span>おと</span><button class="title-btn sub" data-act="sound">${e.sound?"オン":"オフ"}</button></div>
          <div class="tx-row"><span>セーブデータ</span><button class="title-btn danger" data-act="wipe" ${n?"":"disabled"}>けす</button></div>
        </div>
        <div class="title-extra hidden" data-panel="help">
          <div class="help-grid">${b(r,u)}
          </div>
        </div>
        <div class="title-credit">オリジナル作品 / 3Dモデル・音はすべてプログラム生成 <span class="title-ver">v6.0</span></div>
      </div>
    `,this.el.querySelectorAll("[data-act]").forEach(t=>{t.onclick=async()=>{d("ui");const s=t.dataset.act;if(s==="new"){if(n&&!await this.confirmModal("セーブデータがあります。<br>はじめからにすると消えますが、いいですか?"))return;l(),this.onStart?.("new")}else if(s==="continue")this.onStart?.("continue");else if(s==="settings"||s==="help")this.el.querySelectorAll(".title-extra").forEach(a=>{a.classList.toggle("hidden",a.dataset.panel!==s||!a.classList.contains("hidden"))});else if(s==="sound"){const a=i();a.sound=!a.sound,o(a),c(a.sound),t.textContent=a.sound?"オン":"オフ"}else s==="wipe"&&await this.confirmModal("セーブデータを完全に消します。いいですか?")&&(l(),this.render())}})}confirmModal(n){return new Promise(e=>{const t=document.createElement("div");t.className="title-confirm",t.innerHTML=`
        <div class="tc-box">
          <div class="tc-msg">${n}</div>
          <div class="tc-btns">
            <button class="title-btn danger" data-a="ok">はい</button>
            <button class="title-btn" data-a="no">やめる</button>
          </div>
        </div>`,this.el.appendChild(t),t.querySelectorAll("button").forEach(s=>{s.onclick=()=>{d("ui"),t.remove(),e(s.dataset.a==="ok")}})})}setLoading(){const n=this.el.querySelector(".title-menu");n&&(n.innerHTML='<div class="title-loading">島をじゅんびしています…</div>')}dispose(){this.el.remove()}}export{m as TitleScreen};
