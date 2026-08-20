import{ab as o}from"./index-Bkmozk_r.js";import"./CharacterView-DKnWHX98.js";import"./fogFragment-D0SDCwLm.js";import"./passPostProcess-CwEL0ukS.js";import"./texture-DdkB3uke.js";import"./tools-C8vULXJy.js";import"./environmentTextureTools-0xGFwVif.js";import"./dumpTools-yc9roJvp.js";import"./abstractEngine.cubeTexture-D_09RCbX.js";import"./workerPool-CfMXSLnf.js";const e="colorPixelShader",r=`#if defined(VERTEXCOLOR) || defined(INSTANCESCOLOR) && defined(INSTANCES)
#define VERTEXCOLOR
varying vec4 vColor;
#else
uniform vec4 color;
#endif
#include<clipPlaneFragmentDeclaration>
#include<fogFragmentDeclaration>
#define CUSTOM_FRAGMENT_DEFINITIONS
void main(void) {
#define CUSTOM_FRAGMENT_MAIN_BEGIN
#include<clipPlaneFragment>
#if defined(VERTEXCOLOR) || defined(INSTANCESCOLOR) && defined(INSTANCES)
gl_FragColor=vColor;
#else
gl_FragColor=color;
#endif
#include<fogFragment>(color,gl_FragColor)
#define CUSTOM_FRAGMENT_MAIN_END
}`;o.ShadersStore[e]||(o.ShadersStore[e]=r);const C={name:e,shader:r};export{C as colorPixelShader};
