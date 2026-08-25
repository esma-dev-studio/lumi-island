import{ck as o}from"./index-d2vDM9Vu.js";import"./CharacterView-DZRJdEFG.js";import"./fogFragment-DEC6qGTv.js";import"./passPostProcess-CMI1l2Hs.js";import"./texture-BLbLI-LW.js";import"./tools-DHabeNPS.js";import"./environmentTextureTools-_WTrCgqO.js";import"./dumpTools-K7-HUf8o.js";import"./abstractEngine.cubeTexture-Dun7Hdl8.js";import"./workerPool-CfMXSLnf.js";const e="colorPixelShader",r=`#if defined(VERTEXCOLOR) || defined(INSTANCESCOLOR) && defined(INSTANCES)
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
