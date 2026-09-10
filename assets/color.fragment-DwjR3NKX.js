import{cW as o}from"./index-Coz5V6Y7.js";import"./CharacterView-zbyVsgNW.js";import"./fogFragment-Cfz9N1ts.js";import"./passPostProcess-CK3Csbj8.js";import"./texture-D-pV-OaB.js";import"./tools-DP6rEptw.js";import"./environmentTextureTools-BUbnLXi0.js";import"./dumpTools-eiMZ0HTt.js";import"./abstractEngine.cubeTexture-CTAnuvgJ.js";import"./workerPool-CfMXSLnf.js";const e="colorPixelShader",r=`#if defined(VERTEXCOLOR) || defined(INSTANCESCOLOR) && defined(INSTANCES)
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
