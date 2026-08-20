import{G as o,m as i,s as d,H as l,n as c,o as r}from"./index-Bs_pq66_.js";class u{el;onStart=null;constructor(){this.el=document.createElement("div"),this.el.className="title-screen",document.getElementById("ui-root").appendChild(this.el),this.render()}render(){const n=o(),e=i();this.el.innerHTML=`
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
          <div class="help-grid">
            <span><kbd>W A S D</kbd>/<kbd>矢印</kbd></span><span>あるく</span>
            <span><kbd>Shift</kbd></span><span>はしる</span>
            <span><kbd>E</kbd>/<kbd>Space</kbd></span><span>しらべる・とる・はなす</span>
            <span><kbd>Tab</kbd>/<kbd>I</kbd></span><span>もちもの</span>
            <span><kbd>C</kbd></span><span>クラフト</span>
            <span><kbd>Q</kbd></span><span>おねがい</span>
            <span><kbd>R</kbd></span><span>(はいち中)まわす</span>
            <span><kbd>Esc</kbd></span><span>とじる・メニュー</span>
          </div>
        </div>
        <div class="title-credit">オリジナル作品 / 3Dモデル・音はすべてプログラム生成</div>
      </div>
    `,this.el.querySelectorAll("[data-act]").forEach(s=>{s.onclick=async()=>{d("ui");const t=s.dataset.act;if(t==="new"){if(n&&!await this.confirmModal("セーブデータがあります。<br>はじめからにすると消えますが、いいですか?"))return;l(),this.onStart?.("new")}else if(t==="continue")this.onStart?.("continue");else if(t==="settings"||t==="help")this.el.querySelectorAll(".title-extra").forEach(a=>{a.classList.toggle("hidden",a.dataset.panel!==t||!a.classList.contains("hidden"))});else if(t==="sound"){const a=i();a.sound=!a.sound,c(a),r(a.sound),s.textContent=a.sound?"オン":"オフ"}else t==="wipe"&&await this.confirmModal("セーブデータを完全に消します。いいですか?")&&(l(),this.render())}})}confirmModal(n){return new Promise(e=>{const s=document.createElement("div");s.className="title-confirm",s.innerHTML=`
        <div class="tc-box">
          <div class="tc-msg">${n}</div>
          <div class="tc-btns">
            <button class="title-btn danger" data-a="ok">はい</button>
            <button class="title-btn" data-a="no">やめる</button>
          </div>
        </div>`,this.el.appendChild(s),s.querySelectorAll("button").forEach(t=>{t.onclick=()=>{d("ui"),s.remove(),e(t.dataset.a==="ok")}})})}setLoading(){const n=this.el.querySelector(".title-menu");n&&(n.innerHTML='<div class="title-loading">島をじゅんびしています…</div>')}dispose(){this.el.remove()}}export{u as TitleScreen};
