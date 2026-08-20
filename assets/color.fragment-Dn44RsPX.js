import{a9 as o}from"./index-B8PzWfSN.js";import"./CharacterView-7rz-1Mbx.js";import"./fogFragment-wlQTKQLV.js";import"./passPostProcess-BSm2qrHg.js";import"./texture-B1RctWlD.js";import"./tools-BTsLs_L1.js";import"./environmentTextureTools-BgeDsYmL.js";import"./dumpTools-5Bjwr05g.js";import"./abstractEngine.cubeTexture-xptSUq-6.js";import"./workerPool-CfMXSLnf.js";const e="colorPixelShader",r=`#if defined(VERTEXCOLOR) || defined(INSTANCESCOLOR) && defined(INSTANCES)
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
