import{a9 as o}from"./index-DbFMsobL.js";import"./CharacterView-BLdbw_hH.js";import"./fogFragment-y0CDZow3.js";import"./passPostProcess-lwSfoXkZ.js";import"./texture-BZQDm2CF.js";import"./tools-Br-Bc5-W.js";import"./environmentTextureTools-e5UqGnGf.js";import"./dumpTools-Vp2G1HH1.js";import"./abstractEngine.cubeTexture-xhxkafDW.js";import"./workerPool-CfMXSLnf.js";const e="colorPixelShader",r=`#if defined(VERTEXCOLOR) || defined(INSTANCESCOLOR) && defined(INSTANCES)
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
