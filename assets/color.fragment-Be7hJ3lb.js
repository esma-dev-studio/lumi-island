import{a9 as o}from"./index-Bs_pq66_.js";import"./CharacterView-BrorvtRs.js";import"./fogFragment-Dp4KkxAP.js";import"./passPostProcess-9zFwMAgr.js";import"./texture-5QQ79unY.js";import"./tools-9QNkAHTB.js";import"./environmentTextureTools-DvVQpZ9g.js";import"./dumpTools-Z-hIhIUT.js";import"./abstractEngine.cubeTexture-Ckdu7vpv.js";import"./workerPool-CfMXSLnf.js";const e="colorPixelShader",r=`#if defined(VERTEXCOLOR) || defined(INSTANCESCOLOR) && defined(INSTANCES)
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
