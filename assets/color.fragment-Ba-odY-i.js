import{ag as o}from"./index-DVtpSKyF.js";import"./CharacterView-jN-1pE8_.js";import"./fogFragment-B9ddQT9R.js";import"./passPostProcess-BVKwK7F0.js";import"./texture-Dy9KB1Fd.js";import"./tools-DUS-QCRt.js";import"./environmentTextureTools-Ch5KsbT6.js";import"./dumpTools-Cl0n2HuB.js";import"./abstractEngine.cubeTexture-DSq9N4O7.js";import"./workerPool-CfMXSLnf.js";const e="colorPixelShader",r=`#if defined(VERTEXCOLOR) || defined(INSTANCESCOLOR) && defined(INSTANCES)
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
