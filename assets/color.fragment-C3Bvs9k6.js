import{bI as o}from"./index-DgRLn2lE.js";import"./CharacterView-B_i4llwu.js";import"./fogFragment-CCBZLVh6.js";import"./passPostProcess-oVU9f5T_.js";import"./texture-CVwt4QVI.js";import"./tools-BG3rK-Xv.js";import"./environmentTextureTools-CBGWCwAY.js";import"./dumpTools-DJMz1svo.js";import"./abstractEngine.cubeTexture-BL-GLJdO.js";import"./workerPool-CfMXSLnf.js";const e="colorPixelShader",r=`#if defined(VERTEXCOLOR) || defined(INSTANCESCOLOR) && defined(INSTANCES)
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
