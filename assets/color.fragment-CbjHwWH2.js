import{c0 as o}from"./index-B4pCnL3d.js";import"./CharacterView-BGwgliCM.js";import"./fogFragment-BKoywI6X.js";import"./passPostProcess-Y-1zGj6J.js";import"./texture-CydzKaVh.js";import"./tools-CBqI2-FT.js";import"./environmentTextureTools-g5IPR6lT.js";import"./dumpTools-mh_VqHAS.js";import"./abstractEngine.cubeTexture-Dmt969D2.js";import"./workerPool-CfMXSLnf.js";const e="colorPixelShader",r=`#if defined(VERTEXCOLOR) || defined(INSTANCESCOLOR) && defined(INSTANCES)
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
