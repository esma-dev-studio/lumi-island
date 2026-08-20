import{bL as o}from"./index-B4fQvQnx.js";import"./CharacterView-BNcZGGN3.js";import"./fogFragment-vtg0tI0k.js";import"./passPostProcess-CQhGglJi.js";import"./texture-MdfvcRg9.js";import"./tools-D55yGYa7.js";import"./environmentTextureTools-C2gWcZTA.js";import"./dumpTools-DkQCeO8V.js";import"./abstractEngine.cubeTexture-CBbhZ_Qc.js";import"./workerPool-CfMXSLnf.js";const e="colorPixelShader",r=`#if defined(VERTEXCOLOR) || defined(INSTANCESCOLOR) && defined(INSTANCES)
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
