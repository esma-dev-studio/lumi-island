import{c0 as o}from"./index-9L9qbWLd.js";import"./CharacterView-DCpmspYP.js";import"./fogFragment-DTxodRGK.js";import"./passPostProcess-BMvOz-9Z.js";import"./texture-CIK-fno2.js";import"./tools-Bl46E_gG.js";import"./environmentTextureTools-Ciiptgi7.js";import"./dumpTools-yCtB-4Sq.js";import"./abstractEngine.cubeTexture-BLmiwN-e.js";import"./workerPool-CfMXSLnf.js";const e="colorPixelShader",r=`#if defined(VERTEXCOLOR) || defined(INSTANCESCOLOR) && defined(INSTANCES)
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
