import{al as o}from"./index-BZnzI8sM.js";import"./CharacterView-9xWf7DWY.js";import"./fogFragment-CBrMEIAb.js";import"./passPostProcess-De3HvZG3.js";import"./texture-DtuAzKRz.js";import"./tools-C4CtMPs8.js";import"./environmentTextureTools-icKo7mgy.js";import"./dumpTools-C5kXOqf4.js";import"./abstractEngine.cubeTexture-DQu20VqG.js";import"./workerPool-CfMXSLnf.js";const e="colorPixelShader",r=`#if defined(VERTEXCOLOR) || defined(INSTANCESCOLOR) && defined(INSTANCES)
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
