const t="touch-root",e="touch-ui";let p=null;function b(){return typeof document>"u"?null:(p&&p.isConnected||(p=document.querySelector(`.${t}`)),p)}function k(){if(typeof document>"u")return!1;const n=b();return n?!n.classList.contains("hidden"):document.documentElement.classList.contains(e)?!0:typeof window<"u"&&typeof window.matchMedia=="function"&&window.matchMedia("(pointer: coarse)").matches}function c(n,a){return k()?a:n}const o=/<kbd>\s*(?:E|Space)\s*<\/kbd>/gi;function i(n){if(!n)return"";let a=n.replace(o,"");const d=a.search(/<kbd>/i);return d>=0&&(a=a.slice(0,d)),a.trim()}const s=n=>`<div class="help-sec">${n}</div>`,u=`
            ${s("うごく")}
            <span><kbd>W A S D</kbd>/<kbd>矢印</kbd></span><span>あるく</span>
            <span><kbd>Shift</kbd></span><span>はしる</span>
            <span><kbd>マウス</kbd>ドラッグ</span><span>カメラを まわす</span>
            <span><kbd>ホイール</kbd></span><span>ズーム(よる・ひく)</span>
            ${s("さわって つかう")}
            <span><kbd>E</kbd>/<kbd>Space</kbd></span><span>しらべる・とる・はなす</span>
            <span><kbd>X</kbd></span><span>てをふる(つづけて もう一度で よろこぶ)</span>
            <span><kbd>R</kbd></span><span>(はいち中)まわす</span>
            <span><kbd>P</kbd></span><span>しゃしんを とる(フォトモード)</span>
            ${s("しらべると できること")}
            <span>ベンチの まえで <kbd>E</kbd></span><span>すわる(もう一度 <kbd>E</kbd>で たつ)</span>
            <span>たてふだの まえで <kbd>E</kbd></span><span>でんごんばん(きょうの おてつだい)</span>
            <span>おいた かぐの まえで <kbd>E</kbd></span><span>いろみずで いろを ぬる</span>
            <span>おいた かぐの まえで <kbd>R</kbd></span><span>その場で うごかす(もちかえらずに おきなおす)</span>
            <span>しゃしんたての まえで <kbd>E</kbd></span><span>とった しゃしんを かざる</span>
            ${s("がめんを ひらく")}
            <span><kbd>Tab</kbd>/<kbd>I</kbd></span><span>もちもの</span>
            <span><kbd>C</kbd></span><span>クラフト(レシピ / くみあわせ)</span>
            <span><kbd>Q</kbd></span><span>おねがい</span>
            <span><kbd>Z</kbd></span><span>ずかん(バッジ・てがみも ここ)</span>
            <span><kbd>Esc</kbd></span><span>とじる・メニュー</span>`,r=`
            ${s("うごく")}
            <span>左下を ゆびで うごかす</span><span>あるく</span>
            <span>おおきく うごかす</span><span>はしる</span>
            <span>がめんを ゆびで なぞる</span><span>カメラを まわす</span>
            <span>ゆび2本で ひろげる・ちぢめる</span><span>ズーム(よる・ひく)</span>
            ${s("さわって つかう")}
            <span>右下の 大きいボタン</span><span>しらべる・とる・はなす</span>
            <span>「てをふる」ボタン</span><span>てをふる(つづけて もう一度で よろこぶ)</span>
            <span>「まわす」ボタン</span><span>(はいち中)まわす</span>
            <span>右上の「しゃしん」</span><span>しゃしんを とる(フォトモード)</span>
            ${s("しらべると できること")}
            <span>ベンチの そばで 大きいボタン</span><span>すわる(もう一度で たつ)</span>
            <span>たてふだの そばで 大きいボタン</span><span>でんごんばん(きょうの おてつだい)</span>
            <span>おいた かぐの そばで 大きいボタン</span><span>いろみずで いろを ぬる</span>
            <span>「うごかす」ボタン</span><span>その場で うごかす(もちかえらずに おきなおす)</span>
            <span>しゃしんたての そばで 大きいボタン</span><span>とった しゃしんを かざる</span>
            ${s("がめんを ひらく")}
            <span>右上の「もちもの」</span><span>もちもの</span>
            <span>右上の「クラフト」</span><span>クラフト(レシピ / くみあわせ)</span>
            <span>右上の「おねがい」</span><span>おねがい</span>
            <span>右上の「ずかん」</span><span>ずかん(バッジ・てがみも ここ)</span>
            <span>右上の「メニュー」</span><span>とじる・メニュー</span>`;export{r as H,u as a,c as b,i as h,k as i};
