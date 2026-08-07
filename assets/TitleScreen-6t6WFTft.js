import{a0 as l,r as i,s as d,a1 as p,u as o,v as c}from"./index-B4ua3-lf.js";import{b}from"./inputMode-DFSTZpiE.js";const r=`
            <span><kbd>W A S D</kbd>/<kbd>矢印</kbd></span><span>あるく</span>
            <span><kbd>Shift</kbd></span><span>はしる</span>
            <span><kbd>マウス</kbd>ドラッグ</span><span>カメラを まわす</span>
            <span><kbd>ホイール</kbd></span><span>ズーム(よる・ひく)</span>
            <span><kbd>E</kbd>/<kbd>Space</kbd></span><span>しらべる・とる・はなす</span>
            <span><kbd>Tab</kbd>/<kbd>I</kbd></span><span>もちもの</span>
            <span><kbd>C</kbd></span><span>クラフト</span>
            <span><kbd>Q</kbd></span><span>おねがい</span>
            <span><kbd>Z</kbd></span><span>ずかん</span>
            <span><kbd>R</kbd></span><span>(はいち中)まわす</span>
            <span><kbd>Esc</kbd></span><span>とじる・メニュー</span>`,u=`
            <span>左下を ゆびで うごかす</span><span>あるく</span>
            <span>おおきく うごかす</span><span>はしる</span>
            <span>がめんを ゆびで なぞる</span><span>カメラを まわす</span>
            <span>ゆび2本で ひろげる・ちぢめる</span><span>ズーム(よる・ひく)</span>
            <span>右下の 大きいボタン</span><span>しらべる・とる・はなす</span>
            <span>右上の「もちもの」</span><span>もちもの</span>
            <span>右上の「クラフト」</span><span>クラフト</span>
            <span>右上の「おねがい」</span><span>おねがい</span>
            <span>右上の「ずかん」</span><span>ずかん</span>
            <span>「まわす」ボタン</span><span>(はいち中)まわす</span>
            <span>右上の「メニュー」</span><span>とじる・メニュー</span>`;class m{el;onStart=null;constructor(){this.el=document.createElement("div"),this.el.className="title-screen",document.getElementById("ui-root").appendChild(this.el),this.render()}render(){const t=l(),e=i();this.el.innerHTML=`
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
        <div class="title-extra hidden" data-panel="settings">
          <div class="tx-row"><span>おと</span><button class="title-btn sub" data-act="sound">${e.sound?"オン":"オフ"}</button></div>
          <div class="tx-row"><span>セーブデータ</span><button class="title-btn danger" data-act="wipe" ${t?"":"disabled"}>けす</button></div>
        </div>
        <div class="title-extra hidden" data-panel="help">
          <div class="help-grid">${b(r,u)}
          </div>
        </div>
        <div class="title-credit">オリジナル作品 / 3Dモデル・音はすべてプログラム生成 <span class="title-ver">v10.1</span></div>
      </div>
    `,this.el.querySelectorAll("[data-act]").forEach(a=>{a.onclick=async()=>{d("ui");const s=a.dataset.act;if(s==="new"){if(t&&!await this.confirmModal("セーブデータがあります。<br>はじめからにすると消えますが、いいですか?"))return;p(),this.onStart?.("new")}else if(s==="continue")this.onStart?.("continue");else if(s==="settings"||s==="help")this.el.querySelectorAll(".title-extra").forEach(n=>{n.classList.toggle("hidden",n.dataset.panel!==s||!n.classList.contains("hidden"))});else if(s==="sound"){const n=i();n.sound=!n.sound,o(n),c(n.sound),a.textContent=n.sound?"オン":"オフ"}else s==="wipe"&&await this.confirmModal("セーブデータを完全に消します。いいですか?")&&(p(),this.render())}})}confirmModal(t){return new Promise(e=>{const a=document.createElement("div");a.className="title-confirm",a.innerHTML=`
        <div class="tc-box">
          <div class="tc-msg">${t}</div>
          <div class="tc-btns">
            <button class="title-btn danger" data-a="ok">はい</button>
            <button class="title-btn" data-a="no">やめる</button>
          </div>
        </div>`,this.el.appendChild(a),a.querySelectorAll("button").forEach(s=>{s.onclick=()=>{d("ui"),a.remove(),e(s.dataset.a==="ok")}})})}setLoading(){const t=this.el.querySelector(".title-menu");t&&(t.innerHTML='<div class="title-loading">島をじゅんびしています…</div>')}dispose(){this.el.remove()}}export{m as TitleScreen};
