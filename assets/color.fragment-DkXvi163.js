import{a_ as o}from"./index-BM4ZT8-u.js";import"./CharacterView-BvN2GoM9.js";import"./fogFragment-C1uoSyaZ.js";import"./passPostProcess-cnX92ui6.js";import"./texture-DPypEuo2.js";import"./tools-UIe0uxBh.js";import"./environmentTextureTools-BToSx3j0.js";import"./dumpTools-CkLukSWN.js";import"./abstractEngine.cubeTexture-BDNJeo4M.js";import"./workerPool-CfMXSLnf.js";const e="colorPixelShader",r=`#if defined(VERTEXCOLOR) || defined(INSTANCESCOLOR) && defined(INSTANCES)
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
