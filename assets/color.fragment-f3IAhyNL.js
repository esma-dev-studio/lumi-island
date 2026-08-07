import{a9 as o}from"./index-xj9QvDgH.js";import"./CharacterView-BfQKz71n.js";import"./fogFragment-xSHeb3jB.js";import"./passPostProcess-BBYJ9VJ7.js";import"./texture-DBJ4kF_0.js";import"./tools-CK2o2CR6.js";import"./environmentTextureTools-CMoqbcOO.js";import"./dumpTools-BNCKYfSJ.js";import"./abstractEngine.cubeTexture-pWO93A7i.js";import"./workerPool-CfMXSLnf.js";const e="colorPixelShader",r=`#if defined(VERTEXCOLOR) || defined(INSTANCESCOLOR) && defined(INSTANCES)
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
