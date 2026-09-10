// UXボットの「意味矛盾検出」(tools/ux_semantic_check.mjs)のテスト。
// 判定は画面に出る日本語だけを見るので、期待値も実際の画面文字列で書く。
import { describe, it, expect } from 'vitest';
import {
  categorizeObjective,
  categorizeHint,
  isSemanticMatch,
  isShopPanelTitle,
  annotateRow,
  summarizeTrace,
  uxVerdictOf,
  GATHER_CATEGORIES,
} from '../../tools/ux_semantic_check.mjs';
import { GATHER_RULES } from '../../src/systems/GatherSystem';

describe('categorizeObjective(いまやること)', () => {
  it('採取の目的を素材ごとに分ける', () => {
    expect(categorizeObjective('もくざいを あつめよう')).toBe('gatherWood');
    expect(categorizeObjective('いしを あつめよう')).toBe('gatherStone');
    expect(categorizeObjective('クサツルを あつめよう')).toBe('gatherFiber');
    expect(categorizeObjective('ヒカリゴケを あつめよう')).toBe('gatherMoss');
    expect(categorizeObjective('高台で こうせきをほろう')).toBe('gatherOre');
    expect(categorizeObjective('ルミナこうせきを あつめよう')).toBe('gatherOre');
    expect(categorizeObjective('ルミベリーを あつめよう')).toBe('gatherBerry');
  });
  it('つり・報告・受注', () => {
    expect(categorizeObjective('桟橋で サカナをつろう')).toBe('fish');
    expect(categorizeObjective('サカナを 1匹 つろう')).toBe('fish');
    expect(categorizeObjective('ツムギに ほうこくしよう')).toBe('report');
    expect(categorizeObjective('ミナモの はなしを聞こう')).toBe('talk');
  });
  it('クラフト・配置(kbdタグが入っていても読める)', () => {
    expect(categorizeObjective('ざいりょうが そろったよ! <kbd>C</kbd>で ツリザオを作ろう')).toBe('craft');
    expect(categorizeObjective('ざいりょうが そろったよ! Cで ツリザオを作ろう')).toBe('craft');
    expect(categorizeObjective('ランタンを 島に置こう(もちもの→おく)')).toBe('place');
    expect(categorizeObjective('光る家具を 島に置こう')).toBe('place');
  });
  it('NPC不在の待ち案内は就寝、クリア後は自由行動、移動チュートリアルは専用カテゴリ', () => {
    expect(categorizeObjective('ミナモは もう ねているよ<br>家のベッドで 朝まで ねよう')).toBe('sleep');
    expect(categorizeObjective('ノクトは いまは いないよ<br>ベッドで あさまで ねよう')).toBe('sleep');
    expect(categorizeObjective('ミナモは 15時に 桟橋へ くるよ<br>ベッドで ねて まとう')).toBe('sleep');
    expect(categorizeObjective('島で じゆうに くらそう', 'クリア!')).toBe('free');
    expect(categorizeObjective('<kbd>WASD</kbd>か<kbd>矢印キー</kbd>で あるいてみよう')).toBe('tutorial');
  });
  it('headlineの「できた!」だけでも報告と分かる / 未知の文言はunknown', () => {
    expect(categorizeObjective('ツムギに ほうこくしよう', 'できた!')).toBe('report');
    expect(categorizeObjective('')).toBe('unknown');
    expect(categorizeObjective('なぞの もくひょう')).toBe('unknown');
  });
});

describe('categorizeHint(ホットヒント)', () => {
  it('採取の動詞を素材ごとに分ける(GatherSystemのverb)', () => {
    expect(categorizeHint('<kbd>E</kbd>木をきる')).toBe('gatherWood');
    expect(categorizeHint('E木をきる')).toBe('gatherWood');
    expect(categorizeHint('E岩をくだく')).toBe('gatherStone');
    expect(categorizeHint('E草をかる')).toBe('gatherFiber');
    expect(categorizeHint('Eヒカリゴケをとる')).toBe('gatherMoss');
    expect(categorizeHint('Eこうせきをほる')).toBe('gatherOre');
    expect(categorizeHint('Eベリーをつむ')).toBe('gatherBerry');
  });
  it('つり(開始・待ち・かかった)はすべてfish', () => {
    expect(categorizeHint('Eつりをする')).toBe('fish');
    expect(categorizeHint('まってる… Escやめる')).toBe('fish');
    expect(categorizeHint('!! Eつりあげる')).toBe('fish');
  });
  it('会話・店・就寝・配置・もちかえる', () => {
    expect(categorizeHint('Eツムギと はなす')).toBe('talk');
    expect(categorizeHint('Eお店をみる(うる・かう)')).toBe('shop');
    expect(categorizeHint('Eねる(あさまで)')).toBe('sleep');
    expect(categorizeHint('Eおく Rまわす Escやめる')).toBe('place');
    expect(categorizeHint('みずの上には おけないよ — うごかして ばしょを さがそう Rまわす Escやめる')).toBe('place');
    expect(categorizeHint('Eランタンを もちかえる')).toBe('carry');
    expect(categorizeHint('Eつぎへ')).toBe('dialogue');
  });
  it('「◯◯には △△が ひつよう」は行動ではなく理由表示なのでblocked', () => {
    expect(categorizeHint('つりには ツリザオが ひつよう')).toBe('blocked');
    expect(categorizeHint('木をきるには オノが ひつよう')).toBe('blocked');
    expect(categorizeHint('こうせきをほるには ツルハシが ひつよう')).toBe('blocked');
    // 釣りの連打よけ(FishingSystem.canFish の新しい reason)
    expect(categorizeHint('つりには すこし まってから')).toBe('blocked');
  });
  it('ヒントなしはnone / 未知の文言はunknown', () => {
    expect(categorizeHint('')).toBe('none');
    expect(categorizeHint('   ')).toBe('none');
    expect(categorizeHint('Eなぞの そうさ')).toBe('unknown');
  });
  it('v7 マイホームの出入り(enter / exit)', () => {
    expect(categorizeHint('E家に はいる')).toBe('enter');
    expect(categorizeHint('Eそとへ でる')).toBe('exit');
    expect(categorizeHint('<kbd>E</kbd>家に はいる')).toBe('enter');
    expect(categorizeHint('家に はいる')).toBe('enter'); // タッチの行動ボタンのラベル
    expect(categorizeHint('そとへ でる')).toBe('exit');
  });
  it('v10 庭の花だん(うえる・つみとる)は のばなの行動', () => {
    expect(categorizeHint('<kbd>E</kbd>はなを うえる')).toBe('gatherFlower');
    expect(categorizeHint('はなを うえる')).toBe('gatherFlower'); // タッチの行動ボタンのラベル
    expect(categorizeHint('<kbd>E</kbd>つみとる')).toBe('gatherFlower');
    // 育ちきっていない区画・のばなを持っていない場合は「理由表示」なので blocked
    expect(categorizeHint('つみとるには もうすこし まってから')).toBe('blocked');
    expect(categorizeHint('うえるには のばなが ひつよう')).toBe('blocked');
    // 既存の採取ヒントを横取りしない(表の順序が壊れていないこと)
    expect(categorizeHint('<kbd>E</kbd>のばなをつむ')).toBe('gatherFlower');
    expect(categorizeHint('<kbd>E</kbd>ベリーをつむ')).toBe('gatherBerry');
    expect(categorizeHint('<kbd>E</kbd>ほる')).toBe('dig');
    expect(categorizeHint('<kbd>E</kbd>ランタンを もちかえる')).toBe('carry');
  });
  it('v11 虫の予告ヒントも catch にそろう(理由表示は blocked のまま)', () => {
    expect(categorizeHint('<kbd>E</kbd>むしあみでつかまえる')).toBe('catch');
    expect(categorizeHint('むしあみでつかまえる')).toBe('catch'); // タッチの行動ボタンのラベル
    expect(categorizeHint('むしが いる! ちかづいて つかまえよう')).toBe('catch');
    // 「つかまえるには 虫あみが ひつよう」は理由表示なので blocked が先に当たる
    expect(categorizeHint('つかまえるには 虫あみが ひつよう')).toBe('blocked');
  });
});

describe('isSemanticMatch(既知の矛盾を検出する)', () => {
  it('v17.3 いまも矛盾なのは 誘導中の雑談と、報告相手の目の前での よそ見の2つだけ', () => {
    // sec13: もくざいを あつめよう + Eツムギと はなす(誘導中の雑談は いまも隠す)
    expect(isSemanticMatch('gatherWood', 'talk')).toBe(false);
    // sec141〜157: ◯◯に ほうこくしよう + Eつりをする を、相手の目の前(atTarget)で見たとき
    expect(isSemanticMatch('report', 'fish', { atTarget: true })).toBe(false);
    // sec224: もくざいを あつめよう + Eお店をみる は **v17.3 で 陰性へ再ラベル**。
    // 店は どの誘導段階でも 隠れなくなった(ObjectiveSystem の OPEN_KINDS)ので、
    // 工房のカウンターに立った子に 店のヒントが出るのは 正しい画面
    expect(isSemanticMatch('gatherWood', 'shop')).toBe(true);
  });
  it('v17.2 別素材の採取ヒントは もう矛盾ではない(設計変更にあわせた再ラベル)', () => {
    // 誘導中でも どの採取ノードも Eで採れるのが仕様になった
    // (ObjectiveSystem.objectiveActionContext / ObjectiveInteractionPolicy.matchesObjective)。
    // sec179: 高台で こうせきをほろう + Eヒカリゴケをとる
    expect(isSemanticMatch('gatherOre', 'gatherMoss')).toBe(true);
    // sec262: ヒカリゴケを あつめよう + E岩をくだく
    expect(isSemanticMatch('gatherMoss', 'gatherStone')).toBe(true);
  });
  it('報告の相手の目の前での釣りだけがfalse(道すがらの釣りは寄り道)', () => {
    // 相手が Eの輪(1.8m)の内がわ = 目標カードに「→ Nm」も 矢印も 出ていない。
    // このとき selectInteraction は かならず 報告のEを選ぶので、釣りが出ていたら壊れている
    expect(isSemanticMatch('report', 'fish', { atTarget: true })).toBe(false);
    // まだ とどいていない(距離が出ている)あいだの釣りは 仕様どおり(v17.3)
    expect(isSemanticMatch('report', 'fish', { atTarget: false })).toBe(true);
    // 位置が分からない呼び出しは 矛盾にしない(このファイルの方針「迷ったら矛盾にしない」)
    expect(isSemanticMatch('report', 'fish')).toBe(true);
  });
  it('目的と同じ行動のヒントはtrue', () => {
    expect(isSemanticMatch('gatherWood', 'gatherWood')).toBe(true);
    expect(isSemanticMatch('gatherMoss', 'gatherMoss')).toBe(true);
    expect(isSemanticMatch('fish', 'fish')).toBe(true);
    expect(isSemanticMatch('place', 'place')).toBe(true);
    expect(isSemanticMatch('talk', 'talk')).toBe(true);
  });
  it('受注も報告も「はなす」で行うのでtalkヒントはtrue', () => {
    expect(isSemanticMatch('report', 'talk')).toBe(true);
    expect(isSemanticMatch('talk', 'talk')).toBe(true);
  });
  it('未受注(talk)は自由行動あつかい: どのヒントが出ても矛盾ではない', () => {
    // 設計の意味論への較正。ObjectiveSystem.objectiveActionContext は未受注のオファー段階を
    // FREE_CONTEXT()(guided:false)にするので、道すがらの採取・釣り・買い物のEが出るのは仕様どおり。
    expect(isSemanticMatch('talk', 'gatherFiber')).toBe(true);
    expect(isSemanticMatch('talk', 'gatherWood')).toBe(true);
    expect(isSemanticMatch('talk', 'fish')).toBe(true);
    expect(isSemanticMatch('talk', 'shop')).toBe(true);
    expect(isSemanticMatch('talk', 'carry')).toBe(true);
    expect(isSemanticMatch('talk', 'sleep')).toBe(true);
  });
  it('v11 虫とりは常時許可(ObjectiveSystemのALWAYS_ALLOWEDに合わせた較正)', () => {
    // 虫は数秒でとまり直して動き、ホタルは夜しか出ない「あとで戻れない相手」。
    // 依頼中に虫あみを封じると「見えているのに捕れない」になるため、設計として常時許可にした。
    expect(isSemanticMatch('gatherWood', 'catch')).toBe(true);
    expect(isSemanticMatch('report', 'catch')).toBe(true);
    expect(isSemanticMatch('fish', 'catch')).toBe(true);
    expect(isSemanticMatch('sleep', 'catch')).toBe(true);
  });
  it('v11.1 シャベル(dig)も常時許可(ほりあとは日付が変わると別の場所へ移る)', () => {
    // ObjectiveSystem の ALWAYS_ALLOWED に 'dig' が入った。判定器も同じ意味論へそろえる。
    for (const obj of ['gatherWood', 'gatherOre', 'fish', 'report', 'craft', 'place', 'sleep']) {
      expect(isSemanticMatch(obj, 'dig'), `${obj} x dig`).toBe(true);
    }
  });
  it('v11.1 時間限定の拾いもの(かけら・うきだま・カタツムリ)はどの目的中でも許可', () => {
    // 夜だけ・朝だけ・雨の日だけ出て、時間がすぎると消える=「あとで戻れない相手」。
    for (const obj of ['gatherWood', 'gatherOre', 'fish', 'report', 'craft', 'place', 'sleep']) {
      for (const hint of ['gatherStar', 'gatherFloat', 'gatherSnail']) {
        expect(isSemanticMatch(obj, hint), `${obj} x ${hint}`).toBe(true);
      }
    }
    // v17.2: 復活するふつうの採取ノードも 誘導中に採れる仕様になったので ここも true
    expect(isSemanticMatch('gatherWood', 'gatherMoss')).toBe(true);
    expect(isSemanticMatch('gatherMoss', 'gatherStone')).toBe(true);
  });
  it('v11.1 報告のとちゅうの採取は矛盾ではない(釣り・店・もちかえるは従来どおりfalse)', () => {
    // 報告は「その相手に会う」ことだけが条件。道すがら何を採っても遅れない
    // (実プレイの苦情「報告しに行く間にアイテムが拾えない」への修正に合わせた較正)。
    expect(isSemanticMatch('report', 'gatherFiber')).toBe(true);
    expect(isSemanticMatch('report', 'gatherWood')).toBe(true);
    expect(isSemanticMatch('report', 'gatherFlower')).toBe(true);
    // v17.3 報告のとちゅうの 釣り・買いもの・家具いじりも 寄り道あつかい(まだ とどいていないとき)
    for (const hint of ['fish', 'shop', 'carry', 'display', 'place']) {
      expect(isSemanticMatch('report', hint, { atTarget: false }), hint).toBe(true);
      // ただし 相手の目の前では 報告いがいは ぜんぶ矛盾(合否条件そのもの)
      expect(isSemanticMatch('report', hint, { atTarget: true }), hint).toBe(false);
    }
    // 相手の目の前でも「はなす」は もちろん正解
    expect(isSemanticMatch('report', 'talk', { atTarget: true })).toBe(true);
  });
  it('受注済みの段階(guided)で のこる矛盾は 雑談だけ', () => {
    // v17.3 誘導中でも 店・もちかえる・展示・家具の配置は 隠れなくなった
    for (const hint of ['shop', 'carry', 'display', 'place', 'fish']) {
      expect(isSemanticMatch('gatherFiber', hint), hint).toBe(true);
      expect(isSemanticMatch('sleep', hint), hint).toBe(true);
      expect(isSemanticMatch('craft', hint), hint).toBe(true);
      expect(isSemanticMatch('lighthouse', hint), hint).toBe(true);
    }
    // 目的の相手いがいとの雑談だけは 従来どおり矛盾(誘導が空回りするため)
    expect(isSemanticMatch('gatherFiber', 'talk')).toBe(false);
    expect(isSemanticMatch('sleep', 'talk')).toBe(false);
  });
  it('v17.2 報告いがいの誘導段階では、採取も釣りも矛盾ではない', () => {
    // ObjectiveSystem.objectiveActionContext が 報告いがいの全段階に
    // gather と fish を入れたので、判定器も同じ意味論にそろえる(設計意味論への較正)。
    for (const obj of ['gatherFiber', 'gatherWood', 'fish', 'craft', 'place', 'sleep', 'lighthouse']) {
      for (const hint of ['gatherMoss', 'gatherMushroom', 'gatherStar', 'fish']) {
        expect(isSemanticMatch(obj, hint), `${obj} x ${hint}`).toBe(true);
      }
    }
    // v17.3 報告の段階でも 釣りは許す。許さないのは「相手の目の前」だけ
    expect(isSemanticMatch('report', 'fish', { atTarget: false })).toBe(true);
    expect(isSemanticMatch('report', 'fish', { atTarget: true })).toBe(false);
  });
  it('クラフト目的中の採取はtrue(目的文からは不足素材が読み取れないため)', () => {
    expect(isSemanticMatch('craft', 'gatherWood')).toBe(true);
    expect(isSemanticMatch('craft', 'gatherFiber')).toBe(true);
    expect(isSemanticMatch('craft', 'blocked')).toBe(true);
  });
  it('配置目的中の採取もtrue(光る家具3つなど、次の1つを作る必要があるため)', () => {
    expect(isSemanticMatch('place', 'gatherMoss')).toBe(true);
  });
  it('自由行動中・移動チュートリアル中はすべてtrue', () => {
    expect(isSemanticMatch('free', 'shop')).toBe(true);
    expect(isSemanticMatch('free', 'fish')).toBe(true);
    expect(isSemanticMatch('tutorial', 'talk')).toBe(true);
  });
  it('ヒントが空なら矛盾ではない', () => {
    expect(isSemanticMatch('gatherOre', 'none')).toBe(true);
    expect(isSemanticMatch('report', 'none')).toBe(true);
  });
  it('v17.3 店のヒントは どの目的の最中でも矛盾ではない(報告相手の目の前をのぞく)', () => {
    // 店は「うる・かう」= 島でとれた物の出口・道具の入口。誘導中に隠すのを やめた。
    // 進行を横取りしないのは 優先度(shop=40 < 会話35・採取30)が受けもつ
    expect(isSemanticMatch('gatherWood', 'shop')).toBe(true);
    expect(isSemanticMatch('craft', 'shop')).toBe(true);
    expect(isSemanticMatch('place', 'shop')).toBe(true);
    expect(isSemanticMatch('report', 'shop', { atTarget: false })).toBe(true);
    expect(isSemanticMatch('report', 'shop', { atTarget: true })).toBe(false);
  });
  it('判定できない目的は矛盾に数えない(過剰検出を避ける)', () => {
    expect(isSemanticMatch('unknown', 'gatherWood')).toBe(true);
    expect(isSemanticMatch('unknown', 'fish')).toBe(true);
  });
  it('カテゴリ表にないヒントも矛盾に数えない(src側の新しい文言で誤検出しない)', () => {
    expect(isSemanticMatch('gatherWood', 'unknown')).toBe(true);
    expect(isSemanticMatch('report', 'unknown')).toBe(true);
  });
  it('採取目的中の会話だけがfalse(もちかえるは v17.3 で開放)', () => {
    expect(isSemanticMatch('gatherWood', 'talk')).toBe(false);
    expect(isSemanticMatch('place', 'carry')).toBe(true);
  });
  it('「ねる」のヒントはどの目的の最中でもtrue(ALWAYS_ALLOWEDの補助導線)', () => {
    // ObjectiveSystemは ALWAYS_ALLOWED=['sleep'] を guided のどの preferredKinds にも混ぜている。
    // 夜に詰ませないための普遍的な逃げ道なので、blocked/dialogueと同じ常時許可あつかいにする。
    expect(isSemanticMatch('gatherOre', 'sleep')).toBe(true);
    expect(isSemanticMatch('gatherFiber', 'sleep')).toBe(true); // 実測: 走行3の320秒
    expect(isSemanticMatch('fish', 'sleep')).toBe(true);
    expect(isSemanticMatch('report', 'sleep')).toBe(true);
    expect(isSemanticMatch('craft', 'sleep')).toBe(true);
    // v17.2 ベッド誘導中の採取も 矛盾ではない(朝を待つあいだに拾っても 誰も待たせない)。
    // v17.3 店も 同じあつかいになった(朝を待つあいだこそ 売り買いする)
    expect(isSemanticMatch('sleep', 'gatherWood')).toBe(true);
    expect(isSemanticMatch('sleep', 'shop')).toBe(true);
    expect(isSemanticMatch('sleep', 'sleep')).toBe(true);
  });
  it('会話送りのヒントはどの目的中でも矛盾ではない', () => {
    expect(isSemanticMatch('gatherWood', 'dialogue')).toBe(true);
    expect(isSemanticMatch('report', 'dialogue')).toBe(true);
  });
  it('v7 自宅の出入りもどの目的の最中でもtrue(ALWAYS_ALLOWEDの補助導線)', () => {
    // ベッドが家の中へ移ったので、ObjectiveSystem の ALWAYS_ALLOWED は
    // ['sleep','enter','exit']。sleepと同じ「常時許可」の意味論なので同じあつかいにする。
    for (const obj of ['gatherWood', 'gatherOre', 'fish', 'report', 'craft', 'place', 'sleep']) {
      expect(isSemanticMatch(obj, 'enter'), `${obj} x enter`).toBe(true);
      expect(isSemanticMatch(obj, 'exit'), `${obj} x exit`).toBe(true);
    }
    // v17.3 目的そのものがベッド誘導のときも、店のヒントは矛盾ではない
    expect(isSemanticMatch('sleep', 'shop')).toBe(true);
  });
  it('ベッド誘導の目的文は「家に はいって ベッドで ねよう」でもsleep', () => {
    expect(categorizeObjective('ツムギは いまは いないよ<br>家に はいって ベッドで ねよう')).toBe('sleep');
  });
});

describe('annotateRow / summarizeTrace(traceのまとめ判定)', () => {
  it('既存の項目を消さずにカテゴリ判定を足す', () => {
    const row = { sec: 179, obj: '高台で こうせきをほろう', sub: '0 / 3', hint: 'Eヒカリゴケをとる', panel: '', arrow: null, dir: 3 };
    const a = annotateRow(row);
    expect(a.sec).toBe(179);
    expect(a.sub).toBe('0 / 3');
    expect(a.dir).toBe(3);
    expect(a.objectiveCategory).toBe('gatherOre');
    expect(a.hintCategory).toBe('gatherMoss');
    expect(a.semanticMatch).toBe(true); // v17.2 別素材の採取は仕様どおりの画面
  });
  it('矛盾・報告中の釣りを数える', () => {
    const sum = summarizeTrace([
      { sec: 5, obj: 'もくざいを あつめよう', sub: '0 / 5　→ 17m', hint: '' },
      { sec: 10, obj: 'もくざいを あつめよう', sub: '1 / 5', hint: 'E木をきる' },
      // sub に「→ Nm」が無い = 相手が Eの輪の内がわ(atTarget)。ここでの釣りは矛盾
      { sec: 15, obj: 'ミナモに ほうこくしよう', sub: '', hint: 'まってる… Escやめる' },
      { sec: 20, obj: 'ミナモに ほうこくしよう', sub: '', hint: 'Eつりをする' },
      // v17.2: 採取段階の別素材は矛盾ではない。かわりに「誘導中の雑談」を1件入れる
      { sec: 25, obj: 'ヒカリゴケを あつめよう', sub: '1 / 2', hint: 'Eミナモと はなす' },
      { sec: 30, obj: 'ヒカリゴケを あつめよう', sub: '1 / 2', hint: 'E岩をくだく' }, // 仕様どおり
      // v17.3: まだ 37m はなれている報告中の釣り・買いものは 寄り道(数えない)
      { sec: 35, obj: 'ミナモに ほうこくしよう', sub: '→ 37m', hint: 'Eつりをする' },
      { sec: 40, obj: 'ミナモに ほうこくしよう', sub: '→ 20m', hint: 'Eお店をみる(うる・かう)' },
    ]);
    expect(sum.semanticMismatchCount).toBe(3);
    expect(sum.semanticMismatches.map((m) => m.sec)).toEqual([15, 20, 25]);
    expect(sum.refishDuringReportCount).toBe(2);
    expect(sum.stallCount).toBe(0);
    expect(sum.unknownHints).toEqual([]);
  });
  it('表にないヒントは矛盾にせずunknownHintsに残す', () => {
    const sum = summarizeTrace([
      { sec: 5, obj: 'もくざいを あつめよう', sub: '0 / 5', hint: 'Eなぞの そうさ' },
      { sec: 10, obj: 'もくざいを あつめよう', sub: '0 / 5', hint: 'Eなぞの そうさ' },
    ]);
    expect(sum.semanticMismatchCount).toBe(0);
    expect(sum.unknownHints).toEqual(['Eなぞの そうさ']);
  });
  it('同じ目的で60秒すすまなければ停滞1件(距離が縮めば停滞ではない)', () => {
    const stuck = summarizeTrace([
      { sec: 0, obj: 'もくざいを あつめよう', sub: '0 / 5　→ 20m', hint: '' },
      { sec: 30, obj: 'もくざいを あつめよう', sub: '0 / 5　→ 20m', hint: '' },
      { sec: 65, obj: 'もくざいを あつめよう', sub: '0 / 5　→ 22m', hint: '' },
      { sec: 90, obj: 'もくざいを あつめよう', sub: '0 / 5　→ 21m', hint: '' },
    ]);
    expect(stuck.stallCount).toBe(1);
    expect(stuck.stalls[0].durationSec).toBe(65);
    const walking = summarizeTrace([
      { sec: 0, obj: 'ツムギに ほうこくしよう', sub: '→ 40m', hint: '' },
      { sec: 30, obj: 'ツムギに ほうこくしよう', sub: '→ 25m', hint: '' },
      { sec: 65, obj: 'ツムギに ほうこくしよう', sub: '→ 10m', hint: '' },
      { sec: 90, obj: 'ツムギに ほうこくしよう', sub: '', hint: 'Eツムギと はなす' },
    ]);
    expect(walking.stallCount).toBe(0);
    expect(walking.semanticMismatchCount).toBe(0);
  });
});

// v4のUXボット走行(commit c964ee8 の .logs/ux_result.json / result=ok・273秒)の画面ログ全49行。
// 判定器を直したときに「昔の検出が消えていないか」を機械で確かめるための既知コーパス。
// headは当時のボットが記録していないため無し(= categorizeObjective は本文だけで判定する)。
const V4_TRACE = [
  { sec: 8, obj: "WASDか矢印キーで あるいてみよう", sub: "", hint: "" },
  { sec: 13, obj: "もくざいを あつめよう", sub: "0 / 5　→ 17m", hint: "Eツムギと はなす" },
  { sec: 18, obj: "もくざいを あつめよう", sub: "0 / 5　→ 7m", hint: "" },
  { sec: 25, obj: "もくざいを あつめよう", sub: "1 / 5　→ 10m", hint: "" },
  { sec: 30, obj: "もくざいを あつめよう", sub: "3 / 5　→ 17m", hint: "" },
  { sec: 36, obj: "もくざいを あつめよう", sub: "3 / 5　→ 7m", hint: "" },
  { sec: 41, obj: "ツムギに ほうこくしよう", sub: "→ 28m", hint: "" },
  { sec: 46, obj: "ツムギに ほうこくしよう", sub: "→ 15m", hint: "" },
  { sec: 51, obj: "ツムギに ほうこくしよう", sub: "", hint: "" },
  { sec: 56, obj: "ミナモの はなしを聞こう", sub: "→ 23m", hint: "" },
  { sec: 63, obj: "ミナモの はなしを聞こう", sub: "", hint: "Eミナモと はなす" },
  { sec: 68, obj: "もくざいを あつめよう", sub: "0 / 2　→ 4m", hint: "" },
  { sec: 74, obj: "いしを あつめよう", sub: "0 / 1　→ 4m", hint: "" },
  { sec: 79, obj: "もくざいを あつめよう", sub: "0 / 2　→ 34m", hint: "" },
  { sec: 85, obj: "もくざいを あつめよう", sub: "0 / 2　→ 25m", hint: "" },
  { sec: 91, obj: "もくざいを あつめよう", sub: "0 / 2　→ 13m", hint: "" },
  { sec: 96, obj: "もくざいを あつめよう", sub: "0 / 2", hint: "E木をきる" },
  { sec: 102, obj: "クサツルを あつめよう", sub: "0 / 2　→ 4m", hint: "" },
  { sec: 107, obj: "クサツルを あつめよう", sub: "0 / 2　→ 4m", hint: "" },
  { sec: 113, obj: "クサツルを あつめよう", sub: "0 / 2　→ 8m", hint: "" },
  { sec: 118, obj: "クサツルを あつめよう", sub: "0 / 2　→ 11m", hint: "" },
  { sec: 124, obj: "クサツルを あつめよう", sub: "1 / 2　→ 10m", hint: "" },
  { sec: 130, obj: "ざいりょうが そろったよ! Cで ツリザオを作ろう", sub: "", hint: "つりには ツリザオが ひつよう" },
  { sec: 135, obj: "桟橋で サカナをつろう", sub: "0 / 1　→ 37m", hint: "まってる… Escやめる" },
  { sec: 141, obj: "ミナモに ほうこくしよう", sub: "", hint: "まってる… Escやめる" },
  { sec: 146, obj: "ミナモに ほうこくしよう", sub: "", hint: "まってる… Escやめる" },
  { sec: 151, obj: "ミナモに ほうこくしよう", sub: "", hint: "まってる… Escやめる" },
  { sec: 157, obj: "ミナモに ほうこくしよう", sub: "", hint: "Eつりをする" },
  { sec: 162, obj: "ノクトの はなしを聞こう", sub: "→ 32m", hint: "" },
  { sec: 168, obj: "ノクトの はなしを聞こう", sub: "→ 14m", hint: "" },
  { sec: 173, obj: "ノクトの はなしを聞こう", sub: "", hint: "Eノクトと はなす" },
  { sec: 179, obj: "高台で こうせきをほろう", sub: "0 / 3", hint: "Eヒカリゴケをとる" },
  { sec: 184, obj: "高台で こうせきをほろう", sub: "0 / 3", hint: "" },
  { sec: 190, obj: "高台で こうせきをほろう", sub: "1 / 3", hint: "" },
  { sec: 196, obj: "高台で こうせきをほろう", sub: "2 / 3　→ 6m", hint: "" },
  { sec: 202, obj: "ノクトに ほうこくしよう", sub: "", hint: "Eノクトと はなす" },
  { sec: 207, obj: "ツムギの はなしを聞こう", sub: "→ 30m", hint: "" },
  { sec: 213, obj: "ツムギの はなしを聞こう", sub: "→ 16m", hint: "" },
  { sec: 218, obj: "ツムギの はなしを聞こう", sub: "", hint: "" },
  { sec: 224, obj: "もくざいを あつめよう", sub: "0 / 1　→ 15m", hint: "Eお店をみる(うる・かう)" },
  { sec: 230, obj: "もくざいを あつめよう", sub: "0 / 1", hint: "E木をきる" },
  { sec: 235, obj: "ヒカリゴケを あつめよう", sub: "1 / 2　→ 15m", hint: "" },
  { sec: 240, obj: "ヒカリゴケを あつめよう", sub: "1 / 2　→ 9m", hint: "" },
  { sec: 246, obj: "ヒカリゴケを あつめよう", sub: "1 / 2　→ 19m", hint: "" },
  { sec: 251, obj: "ヒカリゴケを あつめよう", sub: "1 / 2　→ 7m", hint: "" },
  { sec: 256, obj: "ヒカリゴケを あつめよう", sub: "1 / 2　→ 10m", hint: "" },
  { sec: 262, obj: "ヒカリゴケを あつめよう", sub: "1 / 2　→ 14m", hint: "E岩をくだく" },
  { sec: 267, obj: "ヒカリゴケを あつめよう", sub: "1 / 2", hint: "" },
  { sec: 272, obj: "ランタンを 島に置こう(もちもの→おく)", sub: "", hint: "Eおく Rまわす Escやめる" },
];
// v4当時 目視で「本物の矛盾」と裁定した8件のうち、いまも矛盾なのは5件。
// 再ラベルした3件は どれも「旧仕様(隠す設計)を陽性として固定していたもの」:
//   179 gatherOre × gatherMoss / 262 gatherMoss × gatherStone …… v17.2 の設計変更。
//     旧仕様は「案内している素材いがいの採取ノードを 誘導中は隠す」で、当時はその画面自体が
//     バグの証拠だった。いまは「どの誘導中でも どの素材でも採れる」が仕様。
//   224 gatherWood × shop …… **v17.3 の設計変更**。旧仕様は「依頼の誘導中は店を隠す」。
//     いまは 店も どの誘導段階でも 候補に残る(ObjectiveSystem の OPEN_KINDS)ので、
//     工房のカウンターに立った子に「Eお店をみる」が出るのは 正しい画面。
//     店が依頼を横取りしないのは 優先度(shop=40 < 会話35)と、受注/報告NPCの先取りが受けもつ。
// のこる5件の性質は 1つも変えていない:
//   13 gatherWood × talk        … 誘導中の雑談は いまも隠す(preferredKinds に talk が入るのは報告だけ)
//   141/146/151/157 report × fish … **報告相手が Eの輪の内がわ(sub に「→ Nm」が無い)**での釣り。
//     v17.3 で 釣りそのものは 報告中でも できるようになったが、この4件は
//     「相手の目の前なのに 報告のEが出ていない」画面なので、新仕様でも 壊れた画面のまま
//     (いまのコードでは selectInteraction が 報告NPCを先取りするので 起こりえない)。
// (再ラベルの根拠は tools/ux_semantic_check.mjs の GATHER_OK_OBJ / OPENED_HINTS のコメント。
//  数も秒も、これ以外の理由で変えてはいけない)
const V4_MISMATCH_SECS = [13, 141, 146, 151, 157];
/** 設計変更で陰性になった3件(旧仕様を陽性として固定していたもの) */
const V4_RELABELED_SECS = [179, 224, 262];

describe('v4過去トレースの回帰(判定器を直しても検出が減らない)', () => {
  it('v4コーパス49行の矛盾はちょうど5件で、秒も従来どおり', () => {
    const sum = summarizeTrace(V4_TRACE);
    expect(V4_TRACE.length).toBe(49);
    expect(sum.semanticMismatchCount).toBe(5);
    expect(sum.semanticMismatches.map((m) => m.sec)).toEqual(V4_MISMATCH_SECS);
  });
  it('5件の中身(目的×ヒントの組)も従来どおり', () => {
    const sum = summarizeTrace(V4_TRACE);
    expect(sum.semanticMismatches.map((m) => `${m.sec}:${m.objectiveCategory}x${m.hintCategory}`)).toEqual([
      '13:gatherWoodxtalk',
      '141:reportxfish',
      '146:reportxfish',
      '151:reportxfish',
      '157:reportxfish',
    ]);
  });
  it('報告中の釣り4件は「相手の目の前(atTarget)」だから のこっている', () => {
    // 距離が出ていない行=相手が1.8mの内がわ。ここで釣りのヒントが出るのは新仕様でも壊れた画面。
    // 逆に「→ Nm」が出ている行の釣りは 寄り道なので数えない
    const sum = summarizeTrace(V4_TRACE);
    const fishRows = sum.trace.filter((r) => [141, 146, 151, 157].includes(r.sec));
    expect(fishRows.length).toBe(4);
    for (const r of fishRows) {
      expect(r.atTarget, `${r.sec}`).toBe(true);
      expect(r.semanticMatch, `${r.sec}`).toBe(false);
    }
    // 同じ4行に 距離だけを足すと、どちらの数え方でも 陰性になる
    const away = summarizeTrace(
      V4_TRACE.map((r) => ([141, 146, 151, 157].includes(r.sec) ? { ...r, sub: '→ 37m' } : r))
    );
    expect(away.semanticMismatchCount).toBe(1); // のこるのは 13 の雑談だけ
    expect(away.refishDuringReportCount).toBe(0);
  });
  it('再ラベルした3件は「別素材の採取」と「誘導中の店」だけ(それ以外の理由で消えていない)', () => {
    const sum = summarizeTrace(V4_TRACE);
    const relabeled = sum.trace.filter((r) => V4_RELABELED_SECS.includes(r.sec));
    expect(relabeled.map((r) => `${r.sec}:${r.objectiveCategory}x${r.hintCategory}`)).toEqual([
      '179:gatherOrexgatherMoss',
      '224:gatherWoodxshop',
      '262:gatherMossxgatherStone',
    ]);
    // 179/262 = v17.2「誘導中の採取段階 × ほかの採取ノード」
    // 224     = v17.3「誘導中の採取段階 × 店」
    for (const r of relabeled) expect(r.semanticMatch, `${r.sec}`).toBe(true);
  });
  it('報告中の釣り4件(相手の目の前)・停滞0件・未知ヒント0件も従来どおり', () => {
    const sum = summarizeTrace(V4_TRACE);
    expect(sum.refishDuringReportCount).toBe(4);
    expect(sum.stallCount).toBe(0);
    expect(sum.unknownHints).toEqual([]);
  });
  it('コーパス内の未受注(talk)の行は較正の前後どちらでもtrue(8件に影響しない)', () => {
    const sum = summarizeTrace(V4_TRACE);
    const talkRows = sum.trace.filter((r) => r.objectiveCategory === 'talk');
    expect(talkRows.length).toBeGreaterThan(0);
    expect(talkRows.every((r) => r.semanticMatch)).toBe(true);
  });
});

describe('v5走行で誤検出した2件(較正で解消する)', () => {
  it('採取目標中の「Eねる(あさまで)」は矛盾ではない(走行3の320秒)', () => {
    // ObjectiveSystemが ALWAYS_ALLOWED で全誘導文脈にsleepを入れているので、
    // 採取目標のまま「ねる」のヒントが出るのは設計どおり。判定器側の誤検出だった。
    const row = annotateRow({ sec: 320, obj: 'クサツルを あつめよう', sub: '1 / 2', hint: 'Eねる(あさまで)' });
    expect(row.objectiveCategory).toBe('gatherFiber');
    expect(row.hintCategory).toBe('sleep');
    expect(row.semanticMatch).toBe(true);
    expect(summarizeTrace([row]).semanticMismatchCount).toBe(0);
  });
  it('未受注の「ノクトの はなしを聞こう」中の「E草をかる」は矛盾ではない', () => {
    // 実測: v5走行446秒。ObjectiveSystemが未受注段階を guided:false にしているので
    // 草刈りのEヒントが出るのは設計どおり。判定器側の誤検出だった。
    const row = annotateRow({ sec: 446, obj: 'ノクトの はなしを聞こう', sub: '→ 40m', hint: 'E草をかる' });
    expect(row.objectiveCategory).toBe('talk');
    expect(row.hintCategory).toBe('gatherFiber');
    expect(row.semanticMatch).toBe(true);
    expect(summarizeTrace([row]).semanticMismatchCount).toBe(0);
  });
});

// v6で増えた拾いもの(のばな・きのこ・かいがら・ほしのかけら)。
// 判定器の表に載せておかないと unknownHints に落ちて「未知ヒント」のまま気づけなくなる。
describe('v6の新しい採取ヒント(4種)', () => {
  it('GatherSystemのverbが素材ごとのカテゴリになる', () => {
    expect(categorizeHint('<kbd>E</kbd>のばなをつむ')).toBe('gatherFlower');
    expect(categorizeHint('Eのばなをつむ')).toBe('gatherFlower');
    expect(categorizeHint('Eきのこをとる')).toBe('gatherMushroom');
    expect(categorizeHint('Eかいがらをひろう')).toBe('gatherShell');
    expect(categorizeHint('Eほしのかけらをひろう')).toBe('gatherStar');
  });
  it('4種とも unknown にならない(未知ヒント扱いのままにしない)', () => {
    const hints = ['Eのばなをつむ', 'Eきのこをとる', 'Eかいがらをひろう', 'Eほしのかけらをひろう'];
    for (const h of hints) expect(categorizeHint(h)).not.toBe('unknown');
    expect(summarizeTrace(hints.map((hint, i) => ({ sec: i, obj: '', hint }))).unknownHints).toEqual([]);
  });
  it('GATHER_RULESのverbと表がずれていない(srcを直したら気づける)', () => {
    // GatherSystem側の文言を変えたのに判定表を直し忘れる、を機械で防ぐ
    const expected: Record<string, string> = {
      flower: 'gatherFlower', mushroom: 'gatherMushroom', shell: 'gatherShell', starshard: 'gatherStar',
      tree: 'gatherWood', rock: 'gatherStone', grass: 'gatherFiber',
      moss: 'gatherMoss', ore: 'gatherOre', berry: 'gatherBerry',
    };
    for (const [kind, cat] of Object.entries(expected)) {
      expect(categorizeHint(`<kbd>E</kbd>${GATHER_RULES[kind as keyof typeof GATHER_RULES].verb}`)).toBe(cat);
    }
  });
  it('目的の文言も素材ごとに分かれる(レシピ駆動の案内が出たとき用)', () => {
    expect(categorizeObjective('のばなを あつめよう')).toBe('gatherFlower');
    expect(categorizeObjective('きのこを あつめよう')).toBe('gatherMushroom');
    expect(categorizeObjective('かいがらを あつめよう')).toBe('gatherShell');
    expect(categorizeObjective('ほしのかけらを あつめよう')).toBe('gatherStar');
  });
  it('採取どうしは同じ素材でも別素材でも一致(v17.2)・craft/place中の採取は許す', () => {
    expect(isSemanticMatch('gatherFlower', 'gatherFlower')).toBe(true);
    // v17.2: 別素材でも矛盾ではない(どの誘導中でも どの素材も採れるのが仕様)
    expect(isSemanticMatch('gatherFlower', 'gatherMushroom')).toBe(true);
    // ほしのかけらは v11.1 から常時許可(時間限定の拾いもの)なので、ここは true
    expect(isSemanticMatch('gatherShell', 'gatherStar')).toBe(true);
    expect(isSemanticMatch('gatherMoss', 'gatherShell')).toBe(true);
    expect(isSemanticMatch('report', 'gatherFlower')).toBe(true);
    expect(isSemanticMatch('craft', 'gatherShell')).toBe(true);
    expect(isSemanticMatch('place', 'gatherStar')).toBe(true);
    expect(isSemanticMatch('free', 'gatherStar')).toBe(true);
    expect(isSemanticMatch('talk', 'gatherFlower')).toBe(true); // 未受注は自由行動あつかい
  });
  it('GATHER_CATEGORIESに4種が入っている(craft/placeの許可がこの集合で決まる)', () => {
    expect(GATHER_CATEGORIES).toContain('gatherFlower');
    expect(GATHER_CATEGORIES).toContain('gatherMushroom');
    expect(GATHER_CATEGORIES).toContain('gatherShell');
    expect(GATHER_CATEGORIES).toContain('gatherStar');
    // v6の6+4=10に、v8の拾いもの4種(こえだ・かりくさ・ねんど・うきだま)を足して14、
    // v9のカタツムリ(雨の日だけ・手でひろう)と わら(カマでかる)を足して16、
    // v11第2章の入り江の2種(ほしくさ・ひかりの貝)を足して18
    expect(GATHER_CATEGORIES).toContain('gatherSnail');
    expect(GATHER_CATEGORIES).toContain('gatherStraw');
    expect(GATHER_CATEGORIES).toContain('gatherStarweed');
    expect(GATHER_CATEGORIES).toContain('gatherLightshell');
    expect(new Set(GATHER_CATEGORIES).size).toBe(GATHER_CATEGORIES.length); // 同じ名前を二重に足していない
    expect(GATHER_CATEGORIES.length).toBe(18);
  });

  it('v9: カタツムリをひろう は採取あつかい(unknownにしない)', () => {
    expect(categorizeHint('<kbd>E</kbd>カタツムリをひろう')).toBe('gatherSnail');
    expect(categorizeHint('Eカタツムリをひろう')).toBe('gatherSnail');
    expect(categorizeObjective('カタツムリを あつめよう')).toBe('gatherSnail');
    expect(summarizeTrace([{ sec: 0, obj: '', hint: 'Eカタツムリをひろう' }]).unknownHints).toEqual([]);
    // ほかの「ひろう」を横取りしていない
    expect(categorizeHint('Eかいがらをひろう')).toBe('gatherShell');
    expect(categorizeHint('Eうきだまをひろう')).toBe('gatherFloat');
    expect(categorizeHint('Eこえだをひろう')).toBe('gatherTwig');
    // クラフト・配置の最中に拾っても矛盾あつかいにしない(ほかの拾いものと同じ)
    expect(isSemanticMatch('craft', 'gatherSnail')).toBe(true);
    expect(isSemanticMatch('place', 'gatherSnail')).toBe(true);
    expect(isSemanticMatch('gatherSnail', 'gatherShell')).toBe(true); // v17.2 別素材も許す
  });
  it('既存の文言の判定は変わらない(新ルールが古いヒントを横取りしない)', () => {
    expect(categorizeHint('Eベリーをつむ')).toBe('gatherBerry');
    expect(categorizeHint('Eヒカリゴケをとる')).toBe('gatherMoss');
    expect(categorizeHint('Eこうせきをほる')).toBe('gatherOre');
    expect(categorizeObjective('ルミベリーを あつめよう')).toBe('gatherBerry');
    expect(categorizeObjective('ヒカリゴケを あつめよう')).toBe('gatherMoss');
    expect(categorizeObjective('ルミナこうせきを あつめよう')).toBe('gatherOre');
  });
});

describe('uxVerdictOf / isShopPanelTitle', () => {
  it('完走かつ矛盾0・再釣り0・店0・停滞0だけがPASS', () => {
    const base = { result: 'ok', semanticMismatchCount: 0, refishDuringReportCount: 0, shopOpens: 0, stallCount: 0 };
    expect(uxVerdictOf(base)).toBe('PASS');
    expect(uxVerdictOf({ ...base, semanticMismatchCount: 1 })).toBe('FAIL');
    expect(uxVerdictOf({ ...base, refishDuringReportCount: 1 })).toBe('FAIL');
    expect(uxVerdictOf({ ...base, shopOpens: 1 })).toBe('FAIL');
    expect(uxVerdictOf({ ...base, stallCount: 1 })).toBe('FAIL');
    expect(uxVerdictOf({ ...base, result: 'timeout' })).toBe('FAIL');
  });
  it('店パネルの見出しを見分ける', () => {
    expect(isShopPanelTitle('ツムギ工房 120 とじる(Esc)')).toBe(true);
    expect(isShopPanelTitle('クラフト とじる(C)')).toBe(false);
    expect(isShopPanelTitle('')).toBe(false);
  });
});

describe('v20 第3章「よるの えき」の新しい語い', () => {
  it('でんしゃの のりおりは 常時許可(enter / exit)', () => {
    expect(categorizeHint('<kbd>E</kbd>でんしゃに のる')).toBe('enter');
    expect(categorizeHint('<kbd>E</kbd>でんしゃで しまへ かえる')).toBe('exit');
    // ふねと同じく、どの目的の最中でも 矛盾にしない(乗りものを 隠すと 詰む)
    for (const obj of ['gatherLightshell', 'report', 'craft', 'place', 'gatherWood']) {
      expect(isSemanticMatch(obj, 'enter'), obj).toBe(true);
      expect(isSemanticMatch(obj, 'exit'), obj).toBe(true);
    }
  });

  it('「いつ来るか」の案内は blocked(押しても何も起きない表示)', () => {
    for (const h of [
      'でんしゃは こんやの 9じごろ くるよ',
      'きょうの でんしゃは 行ってしまった。また つぎの よるに',
      'つぎの でんしゃは あしたの よる 9じごろ',
    ]) {
      expect(categorizeHint(h), h).toBe('blocked');
      expect(isSemanticMatch('gatherWood', categorizeHint(h))).toBe(true);
    }
  });

  it('テンの店は shop(v17.3 誘導中に出ても 矛盾ではない)', () => {
    expect(categorizeHint('<kbd>E</kbd>テンの店を みる(しゅうがわり)')).toBe('shop');
    // v17.3 誘導中でも 矛盾ではない(店は どの段階でも 候補に残る)
    expect(isSemanticMatch('gatherWood', 'shop')).toBe(true);
    expect(isSemanticMatch('free', 'shop')).toBe(true);
  });

  it('でんしゃへの またぎ案内は sail(ふねと同じ「のりばへ向かう段階」)', () => {
    expect(categorizeObjective('よるの えきから でんしゃに のろう')).toBe('sail');
    expect(categorizeObjective('でんしゃで しまへ かえろう')).toBe('sail');
    // ふねの2つは これまでどおり
    expect(categorizeObjective('ふねで しまへ もどろう')).toBe('sail');
    expect(categorizeObjective('ふねで よるの入り江へ わたろう')).toBe('sail');
  });

  it('おつかい・りょうり・キッチンの置きは それぞれ report / craft / place', () => {
    expect(categorizeObjective('ノクトに とどけよう')).toBe('report');
    expect(categorizeObjective('<kbd>C</kbd>の「くみあわせ」で りょうりを 1つ つくろう')).toBe('craft');
    expect(categorizeObjective('キッチンだいを 家の中に おこう(もちもの→おく)')).toBe('place');
  });

  it('第3章の文言は 1つも unknown にならない', () => {
    const objs = [
      'もくざいを あつめよう', 'いしを あつめよう',
      'こうじ代の 1000ルミナを ためよう(ツムギ工房で もちものを うろう)',
      'よるの えきから でんしゃに のろう', 'でんしゃで しまへ かえろう',
      'ひかりの貝を あつめよう', 'ノクトに とどけよう',
      'テンと はなそう', 'テンに ほうこくしよう',
    ];
    for (const o of objs) expect(categorizeObjective(o), o).not.toBe('unknown');
    const hints = [
      '<kbd>E</kbd>でんしゃに のる', '<kbd>E</kbd>でんしゃで しまへ かえる',
      '<kbd>E</kbd>テンの店を みる(しゅうがわり)', '<kbd>E</kbd>テンと はなす',
      'でんしゃは こんやの 9じごろ くるよ', 'つぎの でんしゃは あしたの よる 9じごろ',
      '<kbd>E</kbd>ひかりの貝をひろう',
    ];
    for (const h of hints) expect(categorizeHint(h), h).not.toBe('unknown');
  });

  it('v4コーパスのカテゴリ判定は 1件も 変わらない(新ルールが 古い判定を 横取りしない)', () => {
    expect(categorizeHint('E木をきる')).toBe('gatherWood');
    expect(categorizeHint('Eお店をみる(うる・かう)')).toBe('shop');
    expect(categorizeHint('Eふねに のる')).toBe('sail');
    expect(categorizeHint('Eふねで しまへ かえる')).toBe('sail');
    expect(categorizeObjective('ツムギに ほうこくしよう', 'できた!')).toBe('report');
    expect(categorizeObjective('しゅうり代の 500ルミナを ためよう(ツムギ工房で もちものを うろう)')).toBe('money');
  });
});
