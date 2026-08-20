import{b$ as o}from"./index-DzF9X-gH.js";import"./CharacterView-DjW-Nb9F.js";import"./fogFragment-L0plB9Kh.js";import"./passPostProcess-RAdw-cdm.js";import"./texture-BlaudIle.js";import"./tools-C-ZB4DhW.js";import"./environmentTextureTools-DA1fHDjD.js";import"./dumpTools-C05ok1_V.js";import"./abstractEngine.cubeTexture-6IHeN0G4.js";import"./workerPool-CfMXSLnf.js";const e="colorPixelShader",r=`#if defined(VERTEXCOLOR) || defined(INSTANCESCOLOR) && defined(INSTANCES)
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
