import{ag as o}from"./index-CIoN_X7T.js";import"./CharacterView-BmaD9U3z.js";import"./fogFragment-CMarl2Tl.js";import"./passPostProcess-BUnG6pVR.js";import"./texture-vSDCjpRi.js";import"./tools-sW0hugyL.js";import"./environmentTextureTools-Bq134daO.js";import"./dumpTools-C2D-Ynf7.js";import"./abstractEngine.cubeTexture-TsaysxT4.js";import"./workerPool-CfMXSLnf.js";const e="colorPixelShader",r=`#if defined(VERTEXCOLOR) || defined(INSTANCESCOLOR) && defined(INSTANCES)
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
