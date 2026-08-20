import{b3 as o}from"./index-kwZDXdt4.js";import"./CharacterView-UC7zrtoG.js";import"./fogFragment-CNQlIyy4.js";import"./passPostProcess-DmjeLCR_.js";import"./texture-Cdc6WLCW.js";import"./tools-CFFxr4_a.js";import"./environmentTextureTools-DKH234fY.js";import"./dumpTools-CzevgDgg.js";import"./abstractEngine.cubeTexture-DXWrFlk9.js";import"./workerPool-CfMXSLnf.js";const e="colorPixelShader",r=`#if defined(VERTEXCOLOR) || defined(INSTANCESCOLOR) && defined(INSTANCES)
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
