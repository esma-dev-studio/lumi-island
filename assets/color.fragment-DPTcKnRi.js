import{ab as o}from"./index-Ndx-k36r.js";import"./CharacterView-BcG0_bsg.js";import"./fogFragment-BVlTJ97o.js";import"./passPostProcess-DteTxHAH.js";import"./texture-CV1i9tPD.js";import"./tools-XVY1qTl6.js";import"./environmentTextureTools-DYN35P0I.js";import"./dumpTools-CybszNRG.js";import"./abstractEngine.cubeTexture-BT613l0a.js";import"./workerPool-CfMXSLnf.js";const e="colorPixelShader",r=`#if defined(VERTEXCOLOR) || defined(INSTANCESCOLOR) && defined(INSTANCES)
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
