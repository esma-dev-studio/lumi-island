import{bL as o}from"./index-B7Aivtd1.js";import"./CharacterView-DZaAtBaU.js";import"./fogFragment-DK2Vvzz1.js";import"./passPostProcess-DtDUd7V9.js";import"./texture-Bm-o1OuC.js";import"./tools-C8jTQr82.js";import"./environmentTextureTools-CCPsCRZz.js";import"./dumpTools-DyAfjOEz.js";import"./abstractEngine.cubeTexture-CLChyFrk.js";import"./workerPool-CfMXSLnf.js";const e="colorPixelShader",r=`#if defined(VERTEXCOLOR) || defined(INSTANCESCOLOR) && defined(INSTANCES)
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
