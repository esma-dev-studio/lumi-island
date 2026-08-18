// @vitest-environment jsdom
// v10 会話ボックスの任意ボタン(おくりもの/こうじ/はい・やめる)。
// 守りたいのは「ボタンを足しても、Eだけで会話を送る従来の遊びは何も変わらない」こと。
import { describe, it, expect, beforeEach } from 'vitest';
import { DialogueUI } from '../../src/ui/DialogueUI';

beforeEach(() => {
  document.body.innerHTML = '<div id="ui-root"></div>';
});

const dlgEl = (): HTMLElement => document.querySelector('.dialogue') as HTMLElement;
const buttons = (): HTMLElement[] => [...dlgEl().querySelectorAll('[data-dlg-extra]')] as HTMLElement[];

describe('会話ボックスの任意ボタン', () => {
  it('2つ並べて出せて、押したほうのハンドラだけが動く', () => {
    const dlg = new DialogueUI();
    const pressed: string[] = [];
    dlg.show('ツムギ', ['ひとこと']);
    dlg.addExtraAction('こうじを たのむ(300ルミナ)', () => pressed.push('order'));
    dlg.addExtraAction('おくりものをする', () => pressed.push('gift'));
    expect(dlg.extraLabels).toEqual(['こうじを たのむ(300ルミナ)', 'おくりものをする']);
    const b = buttons();
    expect(b.length).toBe(2);
    b[1].click();
    expect(pressed).toEqual(['gift']);
    b[0].click();
    expect(pressed).toEqual(['gift', 'order']);
    expect(dlg.open).toBe(true); // ボタンは会話を送らない
  });

  it('ボタンは最終行にだけ出る', () => {
    const dlg = new DialogueUI();
    dlg.show('ツムギ', ['1ぎょうめ', '2ぎょうめ']);
    dlg.addExtraAction('こうじを たのむ(300ルミナ)', () => undefined);
    expect(buttons().length).toBe(0);
    dlg.advance();
    expect(buttons().length).toBe(1);
  });

  it('setExtraActions で「はい/やめる」に差しかえられる(前のボタンは消える)', () => {
    const dlg = new DialogueUI();
    const pressed: string[] = [];
    dlg.show('ツムギ', ['ひとこと']);
    dlg.addExtraAction('こうじを たのむ(300ルミナ)', () => pressed.push('order'));
    dlg.setExtraActions([
      { label: 'はい', handler: () => pressed.push('yes') },
      { label: 'やめる', handler: () => pressed.push('no') },
    ]);
    expect(dlg.extraLabels).toEqual(['はい', 'やめる']);
    buttons()[0].click();
    expect(pressed).toEqual(['yes']);
  });

  it('次の会話にボタンを持ちこさない / 閉じたら消える', () => {
    const dlg = new DialogueUI();
    dlg.show('ツムギ', ['ひとこと']);
    dlg.addExtraAction('こうじを たのむ(300ルミナ)', () => undefined);
    dlg.addExtraAction('おくりものをする', () => undefined);
    expect(buttons().length).toBe(2);
    dlg.show('ミナモ', ['べつのはなし']);
    expect(buttons().length).toBe(0);
    dlg.addExtraAction('おくりものをする', () => undefined);
    dlg.close();
    expect(dlg.extraLabels).toEqual([]);
  });

  it('ボタンを2つ出しても、Eだけで会話は終わる(回帰ボット・E2Eに無害)', () => {
    const dlg = new DialogueUI();
    let ended = 0;
    dlg.show('ツムギ', ['ひとこと'], () => ended++);
    dlg.addExtraAction('こうじを たのむ(300ルミナ)', () => undefined);
    dlg.addExtraAction('おくりものをする', () => undefined);
    dlg.advance(); // Eキー相当
    expect(dlg.open).toBe(false);
    expect(ended).toBe(1);
  });

  it('ボタンの中の数字(小さな「1」)を押しても、そのボタンが押されたことになる', () => {
    const dlg = new DialogueUI();
    const pressed: string[] = [];
    dlg.show('ツムギ', ['ひとこと']);
    dlg.addExtraAction('こうじを たのむ(300ルミナ)', () => pressed.push('order'));
    dlg.addExtraAction('おくりものをする', () => pressed.push('gift'));
    const keys = [...dlgEl().querySelectorAll('.dlg-key')] as HTMLElement[];
    expect(keys.map((k) => k.textContent)).toEqual(['1', '2']);
    keys[1].click(); // 数字そのものを押しても closest でボタンにたどりつく
    expect(pressed).toEqual(['gift']);
  });

  it('確認中(blockAdvance)はEでもクリックでも会話が進まない', () => {
    const dlg = new DialogueUI();
    let cancelled = 0;
    dlg.show('ツムギ', ['へやを ひろく する こうじ。300ルミナで いい?']);
    dlg.blockAdvance = true;
    dlg.onBlockedAdvance = () => cancelled++;
    dlgEl().click();
    dlg.advance();
    expect(dlg.open).toBe(true);
    expect(cancelled).toBe(2); // クリックとEの両方が「やめる」に落ちる
  });
});

/**
 * v14.1 数字キー(1・2)でのえらびかた。
 * クリックが 何かの拍子に とどかなくても、キーボードだけで 選択を通せるようにする保険
 * (実害: 透明なオーバーレイが クリックを吸い、こうじも おくりものも たのめなくなった)。
 */
describe('会話の任意ボタンを数字キーでえらぶ(chooseExtra)', () => {
  it('1・2がそれぞれ左・右のボタンに当たる', () => {
    const dlg = new DialogueUI();
    const pressed: string[] = [];
    dlg.show('ツムギ', ['ひとこと']);
    dlg.addExtraAction('こうじを たのむ(300ルミナ)', () => pressed.push('order'));
    dlg.addExtraAction('おくりものをする', () => pressed.push('gift'));
    expect(dlg.chooseExtra(0)).toBe(true);
    expect(dlg.chooseExtra(1)).toBe(true);
    expect(pressed).toEqual(['order', 'gift']);
    expect(dlg.open).toBe(true); // クリックと同じで、会話は送らない
  });

  it('ボタンが出ていない場面では何も起きない(ほかの操作を横取りしない)', () => {
    const dlg = new DialogueUI();
    let pressed = 0;
    // 会話が閉じている
    expect(dlg.chooseExtra(0)).toBe(false);
    // 最終行でない(ボタンはまだ画面に出ていない)
    dlg.show('ツムギ', ['1ぎょうめ', '2ぎょうめ']);
    dlg.addExtraAction('おくりものをする', () => pressed++);
    expect(dlg.chooseExtra(0)).toBe(false);
    expect(pressed).toBe(0);
    // 最終行になったら効く
    dlg.advance();
    expect(dlg.chooseExtra(0)).toBe(true);
    expect(pressed).toBe(1);
    // 出ていない番号は何も起きない
    expect(dlg.chooseExtra(1)).toBe(false);
    expect(pressed).toBe(1);
  });

  it('会話を閉じたあとは効かない(持ちこさない)', () => {
    const dlg = new DialogueUI();
    let pressed = 0;
    dlg.show('ツムギ', ['ひとこと']);
    dlg.addExtraAction('おくりものをする', () => pressed++);
    dlg.close();
    expect(dlg.chooseExtra(0)).toBe(false);
    expect(pressed).toBe(0);
  });
});
