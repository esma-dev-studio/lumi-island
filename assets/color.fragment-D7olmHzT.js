import{a9 as o}from"./index-wFrGheCx.js";import"./CharacterView-SY3DEDBJ.js";import"./fogFragment-Bp5bYkCr.js";import"./passPostProcess-B2lZCdhW.js";import"./texture-BZZbu2dP.js";import"./tools-CquZY0cc.js";import"./environmentTextureTools-CBbU-AXE.js";import"./dumpTools-JMFJCvvm.js";import"./abstractEngine.cubeTexture-DnfWdLL-.js";import"./workerPool-CfMXSLnf.js";const e="colorPixelShader",r=`#if defined(VERTEXCOLOR) || defined(INSTANCESCOLOR) && defined(INSTANCES)
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
