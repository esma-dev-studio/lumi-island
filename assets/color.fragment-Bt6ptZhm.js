import{c0 as o}from"./index-f2acnGIR.js";import"./CharacterView-C363z6cC.js";import"./fogFragment-wNT0HiaP.js";import"./passPostProcess-DXyv77J-.js";import"./texture-BHKkmHJk.js";import"./tools-Bkt0dDQl.js";import"./environmentTextureTools-CAeepaAd.js";import"./dumpTools-ByWSJapE.js";import"./abstractEngine.cubeTexture-31rGiUsX.js";import"./workerPool-CfMXSLnf.js";const e="colorPixelShader",r=`#if defined(VERTEXCOLOR) || defined(INSTANCESCOLOR) && defined(INSTANCES)
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
