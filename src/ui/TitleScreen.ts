// タイトル画面(新規/つづき/せってい/そうさ)
import {
  hasSave, clearSave, loadOpts, saveOpts,
  applyBundle, backupBytes, bundleFileName, exportBundleText, listBackups, parseBundle, restoreBackup,
  type BackupInfo, type ImportFail, type SaveSummary,
} from '../save/SaveSystem';
import { setSoundEnabled } from '../audio/AudioSystem';
import { sfx } from '../audio/AudioSystem';
import { byInput } from './inputMode';
import { HELP_KEYBOARD, HELP_TOUCH } from './helpText';

/** よみこみに失敗したときの言い換え(見出しは子ども向けに1つ。下の1行だけ理由を変える) */
const IMPORT_FAIL_NOTE: Record<ImportFail, string> = {
  badJson: 'ファイルの 中みが こわれているみたい。',
  notBundle: 'これは ルミ島の セーブファイルでは ないみたい。',
  futureFormat: 'これは もっと あたらしい ルミ島の ファイルみたい。',
  checksum: 'ほぞんしたあとに 中みが かわっているみたい。',
  badSave: '中の セーブデータが よみとれなかった。',
};

/** 要約(なんにちめ・ルミナ・バッジ数)の表示。うわがきの確認では かならず これを出す */
function summaryHtml(s: SaveSummary): string {
  return `<div class="tm-sum"><span>${s.day}にちめ</span><span>ルミナ ${s.lumina}</span><span>バッジ ${s.badges}こ</span></div>`;
}

/** ほぞんした日時(M/D HH:MM)。ゲーム内の日づけではなく じっさいの時計 */
function stamp(at: number): string {
  if (!at) return '';
  const d = new Date(at);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export class TitleScreen {
  private el: HTMLElement;
  onStart: ((mode: 'new' | 'continue') => void) | null = null;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'title-screen';
    document.getElementById('ui-root')!.appendChild(this.el);
    this.render();
  }

  private render(): void {
    const saved = hasSave();
    const opts = loadOpts();
    const backups = listBackups().filter((b) => b.summary !== null);
    // せっていを開いたまま読みこみ・もどしをすると再描画されるので、開きっぱなしを引きつぐ
    const openPanel = this.el.querySelector<HTMLElement>('.title-extra:not(.hidden)')?.dataset.panel ?? '';
    const hid = (name: string): string => (openPanel === name ? '' : 'hidden');
    this.el.innerHTML = `
      <div class="title-inner">
        <div class="title-logo">
          <div class="title-jp">ルミ島のくらし</div>
          <div class="title-en">Lumi Island</div>
          <div class="title-sub">夜になると、島がひかる。</div>
        </div>
        <div class="title-menu">
          <button class="title-btn" data-act="new">はじめから</button>
          <button class="title-btn" data-act="continue" ${saved ? '' : 'disabled'}>つづきから</button>
          <button class="title-btn sub" data-act="settings">せってい</button>
          <button class="title-btn sub" data-act="help">そうさほうほう</button>
        </div>
        <div class="title-extra ${hid('settings')}" data-panel="settings">
          <div class="tx-row"><span>おと</span><button class="title-btn sub" data-act="sound">${opts.sound ? 'オン' : 'オフ'}</button></div>
          <div class="tx-row"><span>セーブデータ</span><button class="title-btn danger" data-act="wipe" ${saved ? '' : 'disabled'}>けす</button></div>
          <div class="tx-head">データの まもり</div>
          <div class="tx-col">
            <button class="title-btn sub tx-wide" data-act="export" ${saved ? '' : 'disabled'}>セーブを ファイルに ほぞん</button>
            <button class="title-btn sub tx-wide" data-act="import">ファイルから よみこむ</button>
            <button class="title-btn sub tx-wide" data-act="backups" ${backups.length ? '' : 'disabled'}>まえの データに もどす</button>
          </div>
          <div class="tx-note">ファイルに 保存しておくと、消えても もどせます(おうちの人と いっしょに)。</div>
          <input class="tx-file" type="file" accept="application/json,.json">
        </div>
        <div class="title-extra ${hid('help')}" data-panel="help">
          <div class="help-grid">${byInput(HELP_KEYBOARD, HELP_TOUCH)}
          </div>
        </div>
        <div class="title-credit">オリジナル作品 / 3Dモデル・音はすべてプログラム生成 <span class="title-ver">v15.0</span></div>
      </div>
    `;
    const file = this.el.querySelector<HTMLInputElement>('.tx-file')!;
    file.onchange = () => {
      const f = file.files?.[0];
      file.value = ''; // 同じファイルを2回えらんでも change が起きるようにする
      if (f) void this.importFile(f);
    };
    this.el.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((b) => {
      b.onclick = async () => {
        sfx('ui');
        const act = b.dataset.act!;
        if (act === 'new') {
          if (saved && !(await this.confirmModal('セーブデータがあります。<br>はじめからにすると消えますが、いいですか?'))) return;
          clearSave();
          this.onStart?.('new');
        } else if (act === 'continue') {
          this.onStart?.('continue');
        } else if (act === 'settings' || act === 'help') {
          this.el.querySelectorAll<HTMLElement>('.title-extra').forEach((p) => {
            p.classList.toggle('hidden', p.dataset.panel !== act || !p.classList.contains('hidden'));
          });
          // せっていは中身が増えて画面より縦に長くなったので、開いたらパネルの下まで見えるようにする
          // (スクロールできる形にはしてあるが、開いた瞬間に見えないボタンがあると気づけない)
          this.el.querySelector<HTMLElement>('.title-extra:not(.hidden)')?.scrollIntoView({ block: 'end' });
        } else if (act === 'sound') {
          const o = loadOpts();
          o.sound = !o.sound;
          saveOpts(o);
          setSoundEnabled(o.sound);
          b.textContent = o.sound ? 'オン' : 'オフ';
        } else if (act === 'wipe') {
          if (await this.confirmModal('セーブデータを完全に消します。いいですか?')) {
            clearSave();
            this.render();
          }
        } else if (act === 'export') {
          this.exportFile();
        } else if (act === 'import') {
          file.click();
        } else if (act === 'backups') {
          await this.backupsFlow();
        }
      };
    });
  }

  // ---- セーブを ファイルに ほぞん ----
  /**
   * ダウンロードは **クリックの中で そのまま** 起こす(確認モーダルを はさまない)。
   * iPad Safari は「ユーザーの操作から離れた保存」を止めることがあるため、
   * 確認は「ほぞんしたよ」の あと出しにして、確実に保存が走る形にしてある。
   */
  private exportFile(): void {
    const text = exportBundleText();
    if (!text) {
      void this.infoModal('ほぞんできる セーブデータが ないよ。');
      return;
    }
    const name = bundleFileName();
    try {
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      console.warn('[title] 書き出しに失敗', e);
      void this.infoModal('ファイルに ほぞんできなかった…<br><span class="tm-note">ブラウザの 設定を みてね。</span>');
      return;
    }
    // 書き出した文字列を その場で ほどき直す。「保存したよ」と言う前に
    // 「そのファイルが ほんとうに よみこめる形か」を1回だけ自分で確かめている(自己点検)。
    const parsed = parseBundle(text);
    if (!parsed.ok) console.warn('[title] 書き出した包みが読み直せない:', parsed.reason);
    const sum = parsed.ok ? summaryHtml(parsed.summary) : '';
    void this.infoModal(
      `ファイルに 保存したよ。<br><span class="tm-file">${name}</span>${sum}` +
        '<span class="tm-note">「ダウンロード」や ファイルアプリの 中に あるよ。</span>'
    );
  }

  // ---- ファイルから よみこむ ----
  private async importFile(f: File): Promise<void> {
    let text = '';
    try {
      text = await f.text();
    } catch (e) {
      console.warn('[title] ファイルを読めない', e);
    }
    const r = parseBundle(text);
    if (!r.ok) {
      await this.infoModal(
        `この ファイルは よめなかった…<br><span class="tm-note">${IMPORT_FAIL_NOTE[r.reason]}</span>`
      );
      return;
    }
    const ok = await this.confirmModal(
      `この データを よみこみます。${summaryHtml(r.summary)}` +
        'いまの データに うわがきします。いい?<br>' +
        '<span class="tm-note">いまの データは「まえの データに もどす」で 1回だけ もどせます。</span>'
    );
    if (!ok) return;
    if (!applyBundle(r)) {
      await this.infoModal('よみこめなかった…<br><span class="tm-note">ブラウザの あきようりょうが たりないかも。</span>');
      return;
    }
    setSoundEnabled(loadOpts().sound);
    this.render();
    await this.infoModal(`よみこんだよ。${summaryHtml(r.summary)}「つづきから」で あそべるよ。`);
  }

  // ---- まえの データに もどす ----
  private async backupsFlow(): Promise<void> {
    const list = listBackups().filter((b): b is BackupInfo & { summary: SaveSummary } => b.summary !== null);
    if (list.length === 0) {
      await this.infoModal('まだ まえの データは ないよ。<br><span class="tm-note">日が かわって さいしょに ほぞんしたとき、まえの日の データが ここに たまります。</span>');
      return;
    }
    const kb = Math.max(1, Math.round(backupBytes() / 1024));
    const rows = list.map((b) => ({
      label: `<b>${stamp(b.at)}</b><span>${b.summary.day}にちめ ・ ルミナ ${b.summary.lumina} ・ バッジ ${b.summary.badges}こ</span>`,
      value: b.slot,
    }));
    const slot = await this.chooseModal(
      `どの データに もどしますか?<br><span class="tm-note">あたらしい順。ぜんぶで ${kb}KB。</span>`,
      rows
    );
    if (slot === null) return;
    const target = list.find((b) => b.slot === slot)!;
    const ok = await this.confirmModal(
      `${stamp(target.at)} の データに もどします。${summaryHtml(target.summary)}` +
        'いまの データに うわがきします。いい?<br>' +
        '<span class="tm-note">いまの データは「まえの データに もどす」で 1回だけ もどせます。</span>'
    );
    if (!ok) return;
    if (!restoreBackup(slot)) {
      await this.infoModal('もどせなかった…<br><span class="tm-note">その データは よみとれませんでした。</span>');
      return;
    }
    this.render();
    await this.infoModal(`もどしたよ。${summaryHtml(target.summary)}「つづきから」で あそべるよ。`);
  }

  // ---- モーダル(ネイティブconfirm()の代わり) ----
  /**
   * 選択肢つきのゲーム内モーダル。返すのは選ばれた値(閉じるだけなら cancel の値)。
   * confirm / info / choose は ぜんぶ ここを通す(見た目と閉じかたを1か所にまとめる)。
   */
  private modal<T>(
    msgHtml: string,
    btns: { label: string; value: T; cls?: string }[],
    opts: { vertical?: boolean; cancel?: T } = {}
  ): Promise<T> {
    return new Promise((resolve) => {
      const m = document.createElement('div');
      m.className = 'title-confirm';
      const list = btns
        .map((b, i) => `<button class="title-btn ${b.cls ?? ''}" data-a="${i}">${b.label}</button>`)
        .join('');
      const cancelBtn =
        opts.cancel === undefined ? '' : `<button class="title-btn sub" data-a="cancel">やめる</button>`;
      m.innerHTML = `
        <div class="tc-box">
          <div class="tc-msg">${msgHtml}</div>
          <div class="tc-btns${opts.vertical ? ' tm-col' : ''}">${list}${cancelBtn}</div>
        </div>`;
      m.querySelectorAll<HTMLButtonElement>('button').forEach((btn) => {
        btn.onclick = () => {
          sfx('ui');
          m.remove();
          const a = btn.dataset.a!;
          resolve(a === 'cancel' ? (opts.cancel as T) : btns[Number(a)].value);
        };
      });
      this.el.appendChild(m);
    });
  }

  /** はい / やめる。破壊的な操作は かならずこれを通す */
  private confirmModal(msgHtml: string): Promise<boolean> {
    return this.modal<boolean>(msgHtml, [
      { label: 'はい', value: true, cls: 'danger' },
      { label: 'やめる', value: false },
    ]);
  }

  /** 知らせるだけ(ボタン1つ) */
  private infoModal(msgHtml: string): Promise<boolean> {
    return this.modal<boolean>(msgHtml, [{ label: 'わかった', value: true }]);
  }

  /** たてに ならんだ選択肢から1つ選ぶ(えらばなければ null) */
  private chooseModal<T>(msgHtml: string, rows: { label: string; value: T }[]): Promise<T | null> {
    return this.modal<T | null>(
      msgHtml,
      rows.map((r) => ({ label: r.label, value: r.value, cls: 'sub tm-pick' })),
      { vertical: true, cancel: null }
    );
  }

  setLoading(): void {
    const menu = this.el.querySelector('.title-menu');
    if (menu) menu.innerHTML = '<div class="title-loading">島をじゅんびしています…</div>';
  }

  dispose(): void {
    this.el.remove();
  }
}
