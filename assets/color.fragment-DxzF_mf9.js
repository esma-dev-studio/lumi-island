import{b$ as o}from"./index-DRcUSpnW.js";import"./CharacterView-BS-_50cz.js";import"./fogFragment-6CBCma58.js";import"./passPostProcess-BJHV88Tc.js";import"./texture-D_HRmvNf.js";import"./tools-P4wvcVzx.js";import"./environmentTextureTools-Cju4TMZ9.js";import"./dumpTools-dZJBQt6E.js";import"./abstractEngine.cubeTexture-Bxq7QxsM.js";import"./workerPool-CfMXSLnf.js";const e="colorPixelShader",r=`#if defined(VERTEXCOLOR) || defined(INSTANCESCOLOR) && defined(INSTANCES)
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
