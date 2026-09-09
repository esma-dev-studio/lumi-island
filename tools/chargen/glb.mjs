// GLB組み立て: メッシュ+リグ+アニメ+テクスチャ → glTF 2.0 バイナリ
import { Document, NodeIO } from '@gltf-transform/core';
import { sampleClip } from './anim.mjs';

// character = {
//   id, mesh:{pos,nrm,uv,idx,jnt,wgt}, blinkDelta:Float32Array|null,
//   rig:{names,parents,locals}, clips:{name:clip}, png:Buffer, extraAnims?: {blink:true}
// }
export async function writeGLB(character, outPath) {
  const { id, mesh, rig, clips, png, blinkDelta, face } = character;
  const doc = new Document();
  doc.getRoot().getAsset().generator = 'lumi-chargen';
  const buffer = doc.createBuffer();

  // マテリアル+テクスチャ
  const tex = doc.createTexture(`${id}_albedo`).setImage(new Uint8Array(png)).setMimeType('image/png');
  const mat = doc
    .createMaterial(`${id}_mat`)
    .setBaseColorTexture(tex)
    .setMetallicFactor(0)
    .setRoughnessFactor(0.93);

  // ジョイントノード
  const nodes = {};
  for (const name of rig.names) {
    nodes[name] = doc.createNode(name).setTranslation(rig.locals[name]);
  }
  for (const name of rig.names) {
    const par = rig.parents[name];
    if (par) nodes[par].addChild(nodes[name]);
  }

  // アクセサ
  const acc = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  const posAcc = acc('VEC3', new Float32Array(mesh.pos));
  const nrmAcc = acc('VEC3', new Float32Array(mesh.nrm));
  const uvAcc = acc('VEC2', new Float32Array(mesh.uv));
  const jntAcc = acc('VEC4', new Uint8Array(mesh.jnt));
  const wgtAcc = acc('VEC4', new Float32Array(mesh.wgt));
  const idxAcc = acc('SCALAR', new Uint32Array(mesh.idx));

  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', posAcc)
    .setAttribute('NORMAL', nrmAcc)
    .setAttribute('TEXCOORD_0', uvAcc)
    .setAttribute('JOINTS_0', jntAcc)
    .setAttribute('WEIGHTS_0', wgtAcc)
    .setIndices(idxAcc)
    .setMaterial(mat);

  const meshDef = doc.createMesh(`${id}_mesh`).addPrimitive(prim);

  // まばたきモーフ(目の開閉クアッド入れ替え)
  if (blinkDelta) {
    const dAcc = acc('VEC3', blinkDelta);
    const target = doc.createPrimitiveTarget('blink').setAttribute('POSITION', dAcc);
    prim.addTarget(target);
    meshDef.setWeights([0]);
  }

  // スキン(バインドは平行移動のみ → IBMは-位置の平行移動行列)
  const world = rig.world;
  const ibm = new Float32Array(rig.names.length * 16);
  rig.names.forEach((name, i) => {
    const o = i * 16;
    ibm[o] = 1; ibm[o + 5] = 1; ibm[o + 10] = 1; ibm[o + 15] = 1;
    ibm[o + 12] = -world[name][0];
    ibm[o + 13] = -world[name][1];
    ibm[o + 14] = -world[name][2];
  });
  const skin = doc.createSkin(`${id}_skin`).setInverseBindMatrices(acc('MAT4', ibm));
  for (const name of rig.names) skin.addJoint(nodes[name]);
  skin.setSkeleton(nodes.root);

  const meshNode = doc.createNode(id).setMesh(meshDef).setSkin(skin);

  // 表情(smile/surprised/sad)は 本体とは 別のメッシュ・別のノードにする。
  //
  // なぜ 分けるのか: glTF の モーフの重みは **メッシュ単位**で、weights アニメの
  // 出力は「キーごとに ターゲットの数だけ」値を並べる決まり。本体に ターゲットを
  // 足すと blink のアニメが 1個/キー → 4個/キー に 変わってしまい、
  // 「既存のアニメは 1ミリも 変わっていない」(tools/glb_anim_diff.mjs)が
  // 示せなくなる。さらに blink を 再生した瞬間に 表情の重みが 0 に 上書きされる。
  // 別メッシュなら blink の中身は そのまま、表情は 実行時に 重みで 出し入れできる。
  let faceNode = null;
  if (face) {
    const fm = face.mesh;
    const facePrim = doc
      .createPrimitive()
      .setAttribute('POSITION', acc('VEC3', new Float32Array(fm.pos)))
      .setAttribute('NORMAL', acc('VEC3', new Float32Array(fm.nrm)))
      .setAttribute('TEXCOORD_0', acc('VEC2', new Float32Array(fm.uv)))
      .setAttribute('JOINTS_0', acc('VEC4', new Uint8Array(fm.jnt)))
      .setAttribute('WEIGHTS_0', acc('VEC4', new Float32Array(fm.wgt)))
      .setIndices(acc('SCALAR', new Uint32Array(fm.idx)))
      .setMaterial(mat);
    const faceMeshDef = doc.createMesh(`${id}_face_mesh`).addPrimitive(facePrim);
    const names = Object.keys(face.targets);
    for (const name of names) {
      facePrim.addTarget(doc.createPrimitiveTarget(name).setAttribute('POSITION', acc('VEC3', face.targets[name])));
    }
    faceMeshDef.setWeights(names.map(() => 0));
    faceNode = doc.createNode(`${id}_face`).setMesh(faceMeshDef).setSkin(skin);
  }

  const scene = doc.createScene('scene');
  scene.addChild(nodes.root);
  scene.addChild(meshNode);
  if (faceNode) scene.addChild(faceNode);
  doc.getRoot().setDefaultScene(scene);

  // アニメーション
  for (const [name, clip] of Object.entries(clips)) {
    const anim = doc.createAnimation(name);
    const { rotTracks, posTracks } = sampleClip(clip);
    for (const [joint, tr] of Object.entries(rotTracks)) {
      if (!nodes[joint]) continue;
      const input = acc('SCALAR', new Float32Array(tr.times));
      const output = acc('VEC4', new Float32Array(tr.values));
      const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
      const channel = doc.createAnimationChannel().setTargetNode(nodes[joint]).setTargetPath('rotation').setSampler(sampler);
      anim.addSampler(sampler).addChannel(channel);
    }
    for (const [joint, tr] of Object.entries(posTracks)) {
      if (!nodes[joint]) continue;
      const base = rig.locals[joint];
      const vals = new Float32Array(tr.values.length);
      for (let i = 0; i < tr.values.length; i += 3) {
        vals[i] = base[0] + tr.values[i];
        vals[i + 1] = base[1] + tr.values[i + 1];
        vals[i + 2] = base[2] + tr.values[i + 2];
      }
      const input = acc('SCALAR', new Float32Array(tr.times));
      const sampler = doc.createAnimationSampler().setInput(input).setOutput(acc('VEC3', vals)).setInterpolation('LINEAR');
      const channel = doc.createAnimationChannel().setTargetNode(nodes[joint]).setTargetPath('translation').setSampler(sampler);
      anim.addSampler(sampler).addChannel(channel);
    }
  }

  // blinkアニメ(モーフ重み): 0→1→0 を0.16sで
  if (blinkDelta) {
    const anim = doc.createAnimation('blink');
    const input = acc('SCALAR', new Float32Array([0, 0.06, 0.1, 0.16]));
    const output = acc('SCALAR', new Float32Array([0, 1, 1, 0]));
    const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
    const channel = doc.createAnimationChannel().setTargetNode(meshNode).setTargetPath('weights').setSampler(sampler);
    anim.addSampler(sampler).addChannel(channel);
  }

  const io = new NodeIO();
  await io.write(outPath, doc);
  return doc;
}
